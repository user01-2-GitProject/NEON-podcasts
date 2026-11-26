// B1 — Script QA before publish. A cheap second pass over a *finished* script.
// It only writes notes for the owner; it never rewrites the script and never
// blocks a run. The primary check is a small OpenRouter model; a few obvious
// problems are also checked locally, both as a cross-check and as a fallback
// when no OpenRouter key is configured or the model call fails.
//
// lib/script-check.ts is a different check (repeats, placeholders, markup,
// length, cut-off) and can trigger a rewrite. Leave it alone.

import { sanitizeError } from "@/lib/errors";
import { resolveLlmConfig } from "@/lib/settings";

export const QA_KINDS = ["swear", "number", "acronym", "long-line", "self-name"] as const;
export type ScriptQaKind = (typeof QA_KINDS)[number];

export interface ScriptQaNote {
  kind: ScriptQaKind;
  /** Plain words for the show owner, never a raw provider error. */
  message: string;
  /** Short quote from the script, so the owner can find the line. */
  excerpt?: string;
}

export interface ScriptQa {
  notes: ScriptQaNote[];
  /** Null when the cheap model wasn't used (no key, or it failed quietly). */
  model: string | null;
  checked_at: string;
}

export interface QaConfig {
  openRouterApiKey: string | null;
  openRouterModel?: string | null;
}

// Deliberately a small/cheap model, independent of the (possibly expensive)
// model used to write the script. Owners can override it if they want.
export const DEFAULT_QA_MODEL = "openai/gpt-4o-mini";
export const MAX_QA_LINE = 400;
const MAX_NOTES = 10;
const MAX_MODEL_CHARS = 14_000;
const MAX_MESSAGE = 240;
const MAX_EXCERPT = 160;

/** The body of the wizard's "## Who's going" section, if there is one. */
export function whosGoing(styleGuide: string | null | undefined): string {
  const text = styleGuide || "";
  const heading = /^##\s+Who'?s going\b[^\n]*(?:\n|$)/im.exec(text);
  if (!heading) return "";
  const rest = text.slice(heading.index + heading[0].length);
  const next = rest.search(/^##\s/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

// "Don't say my name", "no names", "never mention the host's name", etc.
export function forbidsNames(whosGoingText: string): boolean {
  const body = whosGoingText || "";
  return (
    /\b(?:don'?t|do\s+not|never|not|avoid)\b[^.!?\n]{0,60}\b(?:say|mention|use|share|read\s+out)\b[^.!?\n]{0,40}\b(?:my|our|his|her|their|your|the\s+host'?s?|names?|anyone'?s\s+name)\b/i.test(body) ||
    /\bno\s+(?:host\s+)?names?\b/i.test(body) ||
    /\bkeep\b[^.!?\n]{0,30}\b(?:my|our|his|her|the\s+host'?s?)\s+name\b[^.!?\n]{0,20}\bout\b/i.test(body)
  );
}

// Names listed in "Who's going". "Me" is the host, so it isn't a name to flag;
// children/family names are included because the rule may be about all names.
export function namesIn(whosGoingText: string): string[] {
  const parts = (whosGoingText || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/,|;|\band\b|\bplus\b|:|\n/)
    .map((part) => part.replace(/^\s*[-*]\s*/, "").replace(/^(?:I'?m|I am|we'?re|we are|me|myself)\s+/i, "").trim());
  const stop = new Set(["me", "myself", "the", "kids", "children", "family", "team", "host", "and", "everyone"]);
  return [...new Set(
    parts
      .filter((part) => /^[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*$/.test(part))
      .filter((part) => !stop.has(part.toLowerCase())),
  )];
}

function excerptAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 40);
  const quote = `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
  return quote.slice(0, MAX_EXCERPT);
}

const SWEAR = /\b(?:fuck(?:ing|ed|er)?|shit(?:ty)?|damn(?:ed)?|bitch|asshole|crap|piss(?:ed)?|bloody hell|wtf)\b/gi;

/**
 * Problems we can spot without a model. Pure: no I/O, safe to unit test.
 * Numbers read wrong and unexplained acronyms need the model's judgement.
 */
export function localQaNotes(script: string, styleGuide?: string | null): ScriptQaNote[] {
  const text = script || "";
  const notes: ScriptQaNote[] = [];

  const swears = new Set<string>();
  for (const match of text.matchAll(SWEAR)) {
    const word = match[0].toLowerCase();
    if (swears.has(word)) continue;
    swears.add(word);
    notes.push({
      kind: "swear",
      message: `The script says "${match[0]}" out loud.`,
      excerpt: excerptAt(text, match.index ?? 0, match[0].length),
    });
    if (swears.size >= 3) break;
  }

  const lines = text.split(/\r?\n/);
  let longLines = 0;
  for (let i = 0; i < lines.length && longLines < 3; i += 1) {
    if (lines[i].length <= MAX_QA_LINE) continue;
    longLines += 1;
    notes.push({
      kind: "long-line",
      message: `Line ${i + 1} is ${lines[i].length} characters — break it up so it reads naturally.`,
      excerpt: `${lines[i].trim().slice(0, 80)}…`,
    });
  }

  const going = whosGoing(styleGuide);
  if (forbidsNames(going)) {
    const names = namesIn(going);
    const patterns = names.map(
      (name) => new RegExp(`\\b(?:I'?m|I am|this is|it'?s)\\s+${name}\\b|\\b${name}\\s+here\\b`, "i"),
    );
    if (patterns.length) {
      for (const re of patterns) {
        const match = re.exec(text);
        if (!match) continue;
        notes.push({
          kind: "self-name",
          message: `The host says their own name ("${match[0].replace(/^(?:I'?m|I am|this is|it'?s)\s+/i, "")}"), but "Who's going" says not to.`,
          excerpt: excerptAt(text, match.index, match[0].length),
        });
      }
    } else {
      // The rule is there but no names were listed: catch a self-introduction.
      const match = /\b(?:I'?m|I am|this is)\s+([A-Z][a-z]+)\b/.exec(text);
      if (match) {
        notes.push({
          kind: "self-name",
          message: `The host says their own name ("${match[1]}"), but "Who's going" says not to.`,
          excerpt: excerptAt(text, match.index, match[0].length),
        });
      }
    }
  }

  return notes.slice(0, MAX_NOTES);
}

/** Prompt for the cheap proofreader. Exported so tests can check it offline. */
export function buildQaPrompt(script: string, styleGuide?: string | null): { system: string; user: string } {
  const going = whosGoing(styleGuide);
  return {
    system: [
      "You proofread a finished podcast script that a text-to-speech engine will read aloud.",
      "You are a checker, not a writer. Do not rewrite the script and do not comment on the topic.",
      "Report only concrete problems you can point to in the script. If there are none, return an empty notes list.",
      "Return ONLY a JSON object: {\"notes\":[{\"kind\":...,\"message\":...,\"excerpt\":...}]}.",
      'kind must be one of: swear, number, acronym, long-line, self-name. message is one short plain sentence for the show owner. excerpt is a short quote from the script.',
      `Report at most 8 notes. Lines over ${MAX_QA_LINE} characters count as long-line.`,
    ].join("\n"),
    user: [
      "SCRIPT:",
      "---",
      (script || "").slice(0, MAX_MODEL_CHARS),
      "---",
      going ? `THE SHOW'S "Who's going" SECTION (direction for the host, not spoken content):\n${going.slice(0, 600)}` : "",
      "",
      "Look for:",
      "- swear: swear words or coarse language the voice would say out loud.",
      "- number: a number or year written in a form that would be read aloud wrongly. Years like 2026 are read as pairs ('twenty twenty six'), not 'two thousand twenty six'. Flag digits or written-out numbers only when the intended reading is clear and wrong or ambiguous.",
      "- acronym: an uppercase acronym (e.g. SEC, GDP) the first time it appears, unless the script explains it in plain words nearby. Common short ones that are spoken as words (NASA, NASA-style names) are fine.",
      "- long-line: a single line longer than 400 characters.",
      "- self-name: ONLY if the \"Who's going\" section says not to say names or the host's name, flag the host introducing themself by name. Otherwise never flag a name.",
      "Do not flag the same problem twice. Do not invent quotes.",
    ].filter(Boolean).join("\n"),
  };
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Turn a model reply into safe, bounded notes. Pure and defensive. */
export function parseQaNotes(text: string): ScriptQaNote[] {
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
  const candidate = parsed && typeof parsed === "object" ? (parsed as { notes?: unknown }).notes : null;
  if (!Array.isArray(candidate)) return [];

  const notes: ScriptQaNote[] = [];
  const seen = new Set<string>();
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { kind?: unknown; message?: unknown; excerpt?: unknown };
    const kind = obj.kind;
    if (typeof kind !== "string" || !(QA_KINDS as readonly string[]).includes(kind)) continue;
    const message = cleanString(obj.message, MAX_MESSAGE);
    if (!message) continue;
    const excerpt = cleanString(obj.excerpt, MAX_EXCERPT);
    const key = `${kind}:${message.toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ kind: kind as ScriptQaKind, message, ...(excerpt ? { excerpt } : {}) });
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}

export interface RunScriptQaOptions {
  script: string;
  styleGuide?: string | null;
  /** Injected in tests so no network call is made. */
  config?: QaConfig;
  fetchImpl?: typeof fetch;
}

/**
 * QA the finished script. Never throws: a model problem is logged through
 * lib/errors.ts and the locally found notes are still saved, so generation
 * carries on and no raw provider error reaches the owner.
 */
export async function runScriptQa(opts: RunScriptQaOptions): Promise<ScriptQa> {
  const local = localQaNotes(opts.script, opts.styleGuide);
  const checkedAt = new Date().toISOString();
  const config = opts.config ?? (await resolveLlmConfig());
  const key = config.openRouterApiKey;
  if (!key) return { notes: local, model: null, checked_at: checkedAt };

  const model = process.env.OPENROUTER_QA_MODEL || DEFAULT_QA_MODEL;
  const { system, user } = buildQaPrompt(opts.script, opts.styleGuide);
  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://neon-podcasts.vercel.app",
        "X-Title": "NEON Podcasts",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`QA model request failed (${res.status})`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const notes = parseQaNotes(data.choices?.[0]?.message?.content || "");
    // Cross-check the obvious things the model may have missed, without
    // duplicating a kind it already reported.
    for (const note of local) {
      if (notes.length >= MAX_NOTES) break;
      if (!notes.some((n) => n.kind === note.kind)) notes.push(note);
    }
    return { notes, model, checked_at: checkedAt };
  } catch (err) {
    sanitizeError(err, "script-qa");
    return { notes: local, model: null, checked_at: checkedAt };
  }
}
