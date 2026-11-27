// Fact-check a finished podcast script against its source material using a
// Mixture of Agents (MoA) approach. Three free OpenRouter models check claims
// independently and in parallel; an aggregator keeps only claims flagged by
// two or more models. If all free models fail, falls back to a single paid
// cheap model. Never rewrites the script or blocks a run — it only writes
// notes for the owner.
//
// Layer 2 (the council) adds two more checkers (Quickdraw and Scholar) plus a
// Lead who decides the verdict. Everything below the Council types is pure:
// no DB, no network, so the API routes and the leader script share one rule
// book. Layer-1 notes are never replaced by a council submission — only
// council-owned fields (agent_notes/verdict/grade/council/...) are.

import { sanitizeError } from "@/lib/errors";
import { resolveLlmConfig } from "@/lib/settings";

export const FACT_CHECK_KINDS = ["wrong", "unsupported", "outdated", "missing-context"] as const;
export type FactCheckKind = (typeof FACT_CHECK_KINDS)[number];

export interface FactCheckNote {
  kind: FactCheckKind;
  message: string;
  excerpt?: string;
  /** How many of the checker models flagged this (MoA quorum). */
  agreed?: number;
}

export interface FactCheck {
  notes: FactCheckNote[];
  /** Comma-separated list of models that answered, or null if none did. */
  model: string | null;
  checked_at: string;
  /** Layer-2 flags, attributed to the persona that raised them. */
  agent_notes?: CouncilFlag[];
  verdict?: "pass" | "fail";
  grade?: ScriptGrade;
  council?: CouncilRecord;
  added_sources?: CouncilSubmission["added_sources"];
  dismissed?: CouncilDismissal[];
}

// Council personas. Only quickdraw and scholar check a script directly; the
// lead reviews their flags (upheld or dismissed with a reason). "qwen" is a
// reserved future checker, so it is accepted in submissions and counts in
// caught_by even though the current council does not run it.
export const COUNCIL_PERSONAS = ["quickdraw", "scholar", "lead"] as const;
export type CouncilPersona = (typeof COUNCIL_PERSONAS)[number];

// Verbatim persona prefixes from the council plan. The dependency-free leader
// script reads the same strings from lib/fact-check-personas.json.
export const PERSONA_PREFIX: Record<"quickdraw" | "scholar", string> = {
  quickdraw:
    "You are the Quickdraw. You care about speed and accuracy above all else. Scan the script against the source material efficiently. Flag only concrete, clear-cut factual errors — wrong names, wrong numbers, wrong dates, wrong outcomes, claims that directly contradict the sources. Don't overthink edge cases or philosophical questions about framing. If the source says X and the script says Y, flag it. If the script adds a claim the sources don't mention at all, flag it as unsupported. Be fast, be precise, don't waste words.",
  scholar:
    "You are the Scholar. You are a strict skeptic and deeply studious. Read every line of the script methodically against every part of the source material. Check dates, names, numbers, context, and implications. Cross-reference claims against multiple sources where possible. Flag not only outright errors but also claims that are technically true but misleading because important context was omitted. Flag outdated information even if it was once correct. Take your time. Thoroughness matters more than speed. If you're unsure about a claim, flag it and explain your doubt.",
};

/** A fact-check note with the council member who raised it. */
export interface CouncilFlag extends FactCheckNote {
  persona: CouncilPersona;
}

/** The Lead's review of one flag. A false positive needs a reason; if the
 * original flagger still disagrees, the flag is unresolved and fails the script. */
export interface CouncilDismissal {
  flag: CouncilFlag;
  reason: string;
  flagger_agrees: boolean;
}

export interface CouncilMemberResult {
  persona: CouncilPersona;
  model: string;
  notes: FactCheckNote[];
}

/** One council run. `verdict` is recomputed by councilVerdict, not trusted. */
export interface CouncilSubmission {
  members: CouncilMemberResult[]; // quickdraw + scholar required, lead optional
  upheld: CouncilFlag[]; // flags the Lead agrees are real
  dismissed: CouncilDismissal[]; // flags the Lead called false positives
  verdict: "pass" | "fail";
  tags?: string[]; // topic/format tags, max 8, each <= 32 chars, lowercased
  added_sources?: { url: string; by: CouncilPersona; accepted: boolean }[];
}

export interface ScriptGrade {
  score: "A" | "B" | "C" | "D" | "F";
  tags: string[];
  error_types: FactCheckKind[];
  /** Persona -> unresolved flags; free_models -> layer-1 note count. */
  caught_by: Record<string, number>;
  notes: string;
}

export interface CouncilRecord {
  verdict: "pass" | "fail";
  voted: CouncilPersona[];
  decided_at: string;
}

// Free models for the MoA panel. Diverse providers reduce correlated errors.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "baidu/ernie-5.5-flash-preview:free",
];
const PAID_FALLBACK = "openai/gpt-4o-mini";
const MIN_AGREEMENT = 2;
/** Per-call cap so one hung free model cannot stall episode generation. */
export const FACT_CHECK_TIMEOUT_MS = 25_000;

const MAX_NOTES = 8;
const MAX_SCRIPT_CHARS = 10_000;
const MAX_BRIEFING_CHARS = 10_000;
const MAX_MESSAGE = 240;
const MAX_EXCERPT = 160;

export function buildFactCheckPrompt(
  script: string,
  briefingSnapshot: string,
): { system: string; user: string } {
  return {
    system: [
      "You fact-check a finished podcast script against the source material it was written from.",
      "You are a checker, not a writer. Do not rewrite the script.",
      "Compare what the script says to what the sources say. Report only concrete factual problems:",
      '- "wrong": the script states something that directly contradicts a source (wrong name, wrong number, wrong date, wrong outcome).',
      '- "unsupported": the script states a specific fact (a number, quote, statistic, or claim) that none of the sources mention or support.',
      '- "outdated": the script uses a fact the sources show has changed or been superseded.',
      '- "missing-context": the script leaves out important context that changes the meaning of a claim.',
      "Do NOT flag opinions, style choices, summaries that simplify without distorting, or general knowledge.",
      "If there are no factual problems, return an empty notes list.",
      "Return ONLY a JSON object: {\"notes\":[{\"kind\":...,\"message\":...,\"excerpt\":...}]}.",
      `Report at most ${MAX_NOTES} notes, most serious first.`,
    ].join("\n"),
    user: [
      "SCRIPT:",
      "---",
      (script || "").slice(0, MAX_SCRIPT_CHARS),
      "---",
      "",
      "SOURCE MATERIAL (briefing docs and research the script was written from):",
      "---",
      (briefingSnapshot || "").slice(0, MAX_BRIEFING_CHARS),
      "---",
      "",
      "Check the script's factual claims against the source material. Flag specific errors with a short quote from the script.",
    ].join("\n"),
  };
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function parseFactCheckNotes(text: string): FactCheckNote[] {
  let raw = (text || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fence) raw = fence[1].trim();
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return [];
    raw = raw.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const candidate =
    parsed && typeof parsed === "object" ? (parsed as { notes?: unknown }).notes : null;
  if (!Array.isArray(candidate)) return [];

  const notes: FactCheckNote[] = [];
  const seen = new Set<string>();
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { kind?: unknown; message?: unknown; excerpt?: unknown };
    const kind = obj.kind;
    if (typeof kind !== "string" || !(FACT_CHECK_KINDS as readonly string[]).includes(kind))
      continue;
    const message = cleanString(obj.message, MAX_MESSAGE);
    if (!message) continue;
    const excerpt = cleanString(obj.excerpt, MAX_EXCERPT);
    const key = `${kind}:${message.toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ kind: kind as FactCheckKind, message, ...(excerpt ? { excerpt } : {}) });
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}

// Normalize a note into a stable key for cross-model comparison. Two models
// flag "the same thing" when their kind matches and either their excerpts
// overlap or their messages are close enough.
export function noteKey(note: FactCheckNote): string {
  const exc = (note.excerpt || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const msg = note.message.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${note.kind}:${exc || msg}`;
}

/** Merge notes from multiple models. Keep only those flagged by >= minAgreement. */
export function aggregateNotes(
  allNotes: FactCheckNote[][],
  minAgreement: number,
): FactCheckNote[] {
  const counts = new Map<string, { note: FactCheckNote; count: number }>();
  for (const notes of allNotes) {
    const seen = new Set<string>();
    for (const note of notes) {
      const key = noteKey(note);
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        if (note.message.length > existing.note.message.length) existing.note = note;
      } else {
        counts.set(key, { note, count: 1 });
      }
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= minAgreement)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_NOTES)
    .map((e) => ({ ...e.note, agreed: e.count }));
}

async function callModel(
  model: string,
  system: string,
  user: string,
  apiKey: string,
  doFetch: typeof fetch,
): Promise<{ notes: FactCheckNote[]; model: string } | null> {
  try {
    const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://neon-podcasts.vercel.app",
        "X-Title": "NEON Podcasts",
      },
      signal: AbortSignal.timeout(FACT_CHECK_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { notes: parseFactCheckNotes(data.choices?.[0]?.message?.content || ""), model };
  } catch {
    return null;
  }
}

export interface RunFactCheckOptions {
  script: string;
  briefingSnapshot: string;
  config?: { openRouterApiKey: string | null };
  fetchImpl?: typeof fetch;
}

export async function runFactCheck(opts: RunFactCheckOptions): Promise<FactCheck> {
  const checkedAt = new Date().toISOString();
  if (!opts.briefingSnapshot?.trim()) {
    return { notes: [], model: null, checked_at: checkedAt };
  }

  try {
    const config = opts.config ?? (await resolveLlmConfig());
    const key = config.openRouterApiKey;
    if (!key) return { notes: [], model: null, checked_at: checkedAt };

    const { system, user } = buildFactCheckPrompt(opts.script, opts.briefingSnapshot);
    const doFetch = opts.fetchImpl ?? fetch;

    // MoA: ask all free models in parallel.
    const results = await Promise.all(
      FREE_MODELS.map((m) => callModel(m, system, user, key, doFetch)),
    );
    const succeeded = results.filter((r): r is NonNullable<typeof r> => r !== null);

    if (succeeded.length >= 2) {
      const notes = aggregateNotes(
        succeeded.map((r) => r.notes),
        MIN_AGREEMENT,
      );
      return {
        notes,
        model: succeeded.map((r) => r.model).join(", "),
        checked_at: checkedAt,
      };
    }

    // Not enough free models answered — fall back to paid model (single call).
    const fallback = await callModel(PAID_FALLBACK, system, user, key, doFetch);
    if (fallback) {
      return { notes: fallback.notes, model: fallback.model, checked_at: checkedAt };
    }

    return { notes: [], model: null, checked_at: checkedAt };
  } catch (err) {
    sanitizeError(err, "fact-check");
    return { notes: [], model: null, checked_at: checkedAt };
  }
}

// ---------------------------------------------------------------------------
// Council (layer 2): pure helpers shared by the API routes and the scripts.
// ---------------------------------------------------------------------------

const MAX_TAG = 32;
const MAX_TAGS = 8;
const MAX_REASON = 1000;
const MAX_URL = 2000;
const MAJOR_KINDS: readonly FactCheckKind[] = ["wrong", "outdated"];

/** Prefix the shared checker prompt with the persona's voice. The prompt body
 * (including the locked source material) stays byte-identical for both members. */
export function buildCouncilPrompt(
  persona: "quickdraw" | "scholar",
  script: string,
  briefingSnapshot: string,
): { system: string; user: string } {
  const base = buildFactCheckPrompt(script, briefingSnapshot);
  return { system: `${PERSONA_PREFIX[persona]}\n\n${base.system}`, user: base.user };
}

/** The unanimous rule: one upheld flag, or one false-positive dismissal the
 * original flagger still disputes, fails the script. Everyone clean = pass. */
export function councilVerdict(s: Pick<CouncilSubmission, "upheld" | "dismissed">): "pass" | "fail" {
  if (s.upheld.length > 0) return "fail";
  if (s.dismissed.some((d) => d.flagger_agrees === false)) return "fail";
  return "pass";
}

function isPersona(value: unknown): value is CouncilPersona {
  return typeof value === "string" && (COUNCIL_PERSONAS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is FactCheckKind {
  return typeof value === "string" && (FACT_CHECK_KINDS as readonly string[]).includes(value);
}

function normalizeNote(value: unknown): FactCheckNote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as { kind?: unknown; message?: unknown; excerpt?: unknown; agreed?: unknown };
  if (!isKind(obj.kind)) return null;
  const message = cleanString(obj.message, MAX_MESSAGE);
  if (!message) return null;
  const excerpt = cleanString(obj.excerpt, MAX_EXCERPT);
  const agreed =
    typeof obj.agreed === "number" && Number.isFinite(obj.agreed) && obj.agreed >= 0
      ? Math.floor(obj.agreed)
      : undefined;
  return {
    kind: obj.kind,
    message,
    ...(excerpt ? { excerpt } : {}),
    ...(agreed !== undefined ? { agreed } : {}),
  };
}

function normalizeFlag(value: unknown): CouncilFlag | null {
  const note = normalizeNote(value);
  if (!note || !value || typeof value !== "object") return null;
  const persona = (value as { persona?: unknown }).persona;
  if (!isPersona(persona)) return null;
  return { ...note, persona };
}

/** Normalize and trust-check a leader submission. The submitted verdict is
 * compared with the recomputed one: a caller cannot hand us a "pass" for a
 * script that still has an unresolved flag. */
export function validateCouncilSubmission(
  body: unknown,
): { ok: true; value: CouncilSubmission } | { ok: false; error: string } {
  const reject = (error: string) => ({ ok: false as const, error });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("Send a council result.");
  }
  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.members)) return reject("Both council members must report.");

  const members: CouncilMemberResult[] = [];
  const personas = new Set<CouncilPersona>();
  for (const raw of obj.members) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("Each member needs a persona and notes.");
    const m = raw as { persona?: unknown; model?: unknown; notes?: unknown };
    if (!isPersona(m.persona)) return reject("Unknown council persona.");
    if (personas.has(m.persona)) return reject("Each persona may report only once.");
    const model = cleanString(m.model, 120);
    if (!model) return reject("Each member needs a model name.");
    if (!Array.isArray(m.notes)) return reject("Each member needs a notes list.");
    const notes: FactCheckNote[] = [];
    for (const rawNote of m.notes) {
      const note = normalizeNote(rawNote);
      if (!note) return reject("Member notes need a known kind and a message.");
      notes.push(note);
    }
    personas.add(m.persona);
    members.push({ persona: m.persona, model, notes });
  }
  if (!personas.has("quickdraw") || !personas.has("scholar")) {
    return reject("Quickdraw and Scholar must both report.");
  }

  if (!Array.isArray(obj.upheld)) return reject("Upheld flags must be a list.");
  const upheld: CouncilFlag[] = [];
  for (const raw of obj.upheld) {
    const flag = normalizeFlag(raw);
    if (!flag) return reject("An upheld flag needs a known kind, message and persona.");
    if (!personas.has(flag.persona)) return reject("A flag came from a member who did not report.");
    upheld.push(flag);
  }

  if (!Array.isArray(obj.dismissed)) return reject("Dismissed flags must be a list.");
  const dismissed: CouncilDismissal[] = [];
  for (const raw of obj.dismissed) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("Each dismissal needs a flag and a reason.");
    const d = raw as { flag?: unknown; reason?: unknown; flagger_agrees?: unknown };
    const flag = normalizeFlag(d.flag);
    const reason = cleanString(d.reason, MAX_REASON);
    if (!flag || !reason) return reject("Each dismissal needs a flag and a reason.");
    if (!personas.has(flag.persona)) return reject("A flag came from a member who did not report.");
    if (typeof d.flagger_agrees !== "boolean") return reject("Say whether the original flagger agrees.");
    dismissed.push({ flag, reason, flagger_agrees: d.flagger_agrees });
  }

  const tags: string[] = [];
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) return reject("Tags must be a list.");
    for (const raw of obj.tags) {
      if (typeof raw !== "string") return reject("Tags must be words.");
      if (raw.trim().length > MAX_TAG) return reject(`Tags must be at most ${MAX_TAG} characters.`);
      const tag = cleanString(raw, MAX_TAG).toLowerCase();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    if (tags.length > MAX_TAGS) return reject(`Use at most ${MAX_TAGS} tags.`);
  }

  const added_sources: NonNullable<CouncilSubmission["added_sources"]> = [];
  if (obj.added_sources !== undefined) {
    if (!Array.isArray(obj.added_sources)) return reject("Added sources must be a list.");
    for (const raw of obj.added_sources) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("Each added source needs a URL.");
      const s = raw as { url?: unknown; by?: unknown; accepted?: unknown };
      const url = cleanString(s.url, MAX_URL);
      if (!url) return reject("Each added source needs a URL.");
      if (!isPersona(s.by)) return reject("An added source needs a council persona.");
      if (typeof s.accepted !== "boolean") return reject("Say whether the Lead accepted the added source.");
      added_sources.push({ url, by: s.by, accepted: s.accepted });
    }
  }

  const verdict = obj.verdict;
  if (verdict !== "pass" && verdict !== "fail") return reject("Verdict must be pass or fail.");
  if (verdict !== councilVerdict({ upheld, dismissed })) {
    return reject("verdict does not follow the unanimous rule");
  }

  return { ok: true, value: { members, upheld, dismissed, verdict, tags, added_sources } };
}

/** Flags that still count against the script: upheld by the Lead, or dismissed
 * but disputed by the original flagger. Deduped by persona + noteKey. */
function unresolvedFlags(s: CouncilSubmission): CouncilFlag[] {
  const seen = new Set<string>();
  const unresolved: CouncilFlag[] = [];
  for (const flag of [...s.upheld, ...s.dismissed.filter((d) => !d.flagger_agrees).map((d) => d.flag)]) {
    const key = `${flag.persona}:${noteKey(flag)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unresolved.push(flag);
  }
  return unresolved;
}

// Tags are topic/format labels chosen by the Lead (or the leader script's
// script heuristics) and validated above. Keep them lowercase, short, sorted
// and capped so the same submission always produces the same grade.
function deriveTags(s: CouncilSubmission): string[] {
  const tags: string[] = [];
  for (const raw of s.tags ?? []) {
    const tag = cleanString(raw, MAX_TAG).toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags.sort();
}

function personaLabel(persona: CouncilPersona): string {
  return persona.charAt(0).toUpperCase() + persona.slice(1);
}

/** F10 auto grading. A = clean pass, B = pass after false positives were
 * dismissed, C = minor-only fail, D = one major (or >2 minor flags), F = two
 * or more major errors. `wrong` and `outdated` are major; `unsupported` and
 * `missing-context` are minor. */
export function gradeScript(s: CouncilSubmission, layer1: FactCheckNote[]): ScriptGrade {
  const unresolved = unresolvedFlags(s);
  const majors = unresolved.filter((f) => MAJOR_KINDS.includes(f.kind));
  let score: ScriptGrade["score"];
  if (s.verdict === "pass") {
    score = s.dismissed.length === 0 ? "A" : "B";
  } else if (majors.length >= 2) {
    score = "F";
  } else if (majors.length === 1 || unresolved.length > 2) {
    score = "D";
  } else {
    score = "C";
  }

  const caught_by: Record<string, number> = {};
  for (const persona of COUNCIL_PERSONAS) caught_by[persona] = 0;
  for (const member of s.members) if (!(member.persona in caught_by)) caught_by[member.persona] = 0;
  for (const flag of unresolved) caught_by[flag.persona] = (caught_by[flag.persona] ?? 0) + 1;
  caught_by.free_models = layer1.length;

  const error_types = FACT_CHECK_KINDS.filter((kind) => unresolved.some((f) => f.kind === kind));

  let notes: string;
  if (score === "A") notes = "Pass: no flags.";
  else if (score === "B") {
    const n = s.dismissed.length;
    notes = `Pass: ${n} false positive${n === 1 ? "" : "s"} dismissed with an explanation.`;
  } else if (score === "F") {
    notes = `Fail: ${majors.length} major factual errors.`;
  } else if (majors.length === 1) {
    const kind = majors[0].kind === "outdated" ? "outdated fact" : "wrong fact";
    notes = `Fail: ${personaLabel(majors[0].persona)} flagged 1 ${kind}.`;
  } else {
    notes = `Fail: ${unresolved.length} minor flags need review.`;
  }

  return { score, tags: deriveTags(s), error_types, caught_by, notes };
}

/** Replace the previous council fields with a fresh run's result. Layer-1
 * notes, model and checked_at are copied over untouched: an agent submission
 * can never erase what the automatic checkers wrote. Re-submitting replaces
 * (never appends to) council fields. The Lead's review is represented by
 * `upheld` (flags accepted) and `dismissed` (flags rejected, with a reason and
 * whether the original flagger accepted it), plus `council.voted`. */
export function mergeCouncilResult(
  existing: FactCheck | null,
  s: CouncilSubmission,
  now: Date = new Date(),
): FactCheck {
  const decidedAt = now.toISOString();
  const base: FactCheck = existing ?? { notes: [], model: null, checked_at: decidedAt };
  const seen = new Set<string>();
  const agent_notes = unresolvedFlags(s).filter((flag) => {
    const key = noteKey(flag);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    notes: base.notes,
    model: base.model,
    checked_at: base.checked_at,
    agent_notes,
    verdict: s.verdict,
    grade: gradeScript(s, base.notes),
    dismissed: s.dismissed,
    added_sources: s.added_sources,
    council: {
      verdict: s.verdict,
      voted: s.members.map((m) => m.persona),
      decided_at: decidedAt,
    },
  };
}
