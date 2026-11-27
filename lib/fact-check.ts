// Fact-check a finished podcast script against its source material using a
// Mixture of Agents (MoA) approach. Three free OpenRouter models check claims
// independently and in parallel; an aggregator keeps only claims flagged by
// two or more models. If all free models fail, falls back to a single paid
// cheap model. Never rewrites the script or blocks a run — it only writes
// notes for the owner.

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
}

// Free models for the MoA panel. Diverse providers reduce correlated errors.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "baidu/ernie-5.5-flash-preview:free",
];
const PAID_FALLBACK = "openai/gpt-4o-mini";
const MIN_AGREEMENT = 2;

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
function noteKey(note: FactCheckNote): string {
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

  const config = opts.config ?? (await resolveLlmConfig());
  const key = config.openRouterApiKey;
  if (!key) return { notes: [], model: null, checked_at: checkedAt };

  const { system, user } = buildFactCheckPrompt(opts.script, opts.briefingSnapshot);
  const doFetch = opts.fetchImpl ?? fetch;

  try {
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
