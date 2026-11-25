// Checks a written script before it's turned into audio, so problems are
// caught by the app instead of by someone reading every script.
// Pure: no I/O. Used by generateEpisode and the tests.

export type ScriptIssueKind =
  | "repeat"
  | "placeholder"
  | "markup"
  | "too-short"
  | "too-long"
  | "cut-off"
  | "behind-the-scenes";

export interface ScriptIssue {
  kind: ScriptIssueKind;
  // Plain words for the show owner and for the rewrite request.
  message: string;
}

const WORDS_PER_MINUTE = 150;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentencesOf(script: string): string[] {
  return script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

// The same long sentence twice is how a stuck or looping script shows up.
function repeatedSentences(script: string): string[] {
  const seen = new Map<string, number>();
  const repeats: string[] = [];
  for (const sentence of sentencesOf(script)) {
    if (words(sentence).length < 8) continue;
    const key = norm(sentence);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) repeats.push(sentence);
  }
  return repeats;
}

const PLACEHOLDER = /\[(insert|name|date|todo|tbd|link|source)[^\]]*\]|\b(TODO|TBD|lorem ipsum)\b|\{\{[^}]*\}\}|<[A-Z_]{3,}>/i;
const MARKUP: { re: RegExp; what: string }[] = [
  { re: /^#{1,6}\s/m, what: "headings" },
  { re: /\*\*[^*]+\*\*/, what: "bold markers" },
  { re: /^\s*[-*•]\s+\S/m, what: "bullet points" },
  { re: /\[(music|pause|sfx|sound|intro|outro|laughs?|beat)[^\]]*\]|\((music|pause|sfx|sound effect|laughs?|beat)[^)]*\)/i, what: "stage directions" },
  { re: /^\s*(host|narrator|speaker \d|announcer)\s*:/im, what: "speaker labels" },
  { re: /https?:\/\/\S+/i, what: "web addresses" },
];

// The host reading the show's setup out loud ("the only rule on this show
// is...", "as instructed") instead of just following it.
const BEHIND_THE_SCENES =
  /\b(?:the|our) (?:only |one |main |first |golden )?rules? (?:of|on|for|in) (?:the|this|our) (?:show|podcast|program|episode)\b|\b(?:the|my|our) style guide\b|\bas (?:instructed|directed|requested in the brief)\b|\b(?:per|according to) (?:the|my) (?:brief|instructions|show notes)\b|\bI(?:'m| am) (?:an AI|a language model|instructed|told to)\b/i;

export function checkScript(script: string, targetMinutes: number): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const text = script.trim();
  const wordCount = words(text).length;
  const target = Math.max(1, targetMinutes) * WORDS_PER_MINUTE;

  const repeats = repeatedSentences(text);
  if (repeats.length) {
    const first = repeats[0].length > 80 ? `${repeats[0].slice(0, 77)}…` : repeats[0];
    issues.push({
      kind: "repeat",
      message: `The script repeats itself (${repeats.length} sentence${repeats.length === 1 ? "" : "s"} appear twice, e.g. "${first}").`,
    });
  }

  const placeholder = PLACEHOLDER.exec(text);
  if (placeholder) {
    issues.push({ kind: "placeholder", message: `The script has a fill-in-the-blank left in it: "${placeholder[0]}".` });
  }

  const found = MARKUP.filter((m) => m.re.test(text)).map((m) => m.what);
  if (found.length) {
    issues.push({ kind: "markup", message: `The script has things the voice would read out loud: ${found.join(", ")}.` });
  }

  const meta = BEHIND_THE_SCENES.exec(text);
  if (meta) {
    issues.push({
      kind: "behind-the-scenes",
      message: `The host reads the show's setup out loud ("${meta[0]}") instead of just following it.`,
    });
  }

  if (wordCount < target * 0.5) {
    issues.push({
      kind: "too-short",
      message: `The script is much shorter than asked (about ${Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))} of ${targetMinutes} minutes).`,
    });
  } else if (wordCount > target * 1.6) {
    issues.push({
      kind: "too-long",
      message: `The script is much longer than asked (about ${Math.round(wordCount / WORDS_PER_MINUTE)} of ${targetMinutes} minutes).`,
    });
  }

  if (text && !/[.!?…"'”’)]$/.test(text)) {
    issues.push({ kind: "cut-off", message: "The script stops mid-sentence." });
  }

  return issues;
}

// Issues worth one rewrite. Length alone isn't: a short script on a slow news
// day is fine.
export function needsRewrite(issues: ScriptIssue[]): boolean {
  return issues.some((i) => i.kind !== "too-short" && i.kind !== "too-long");
}

// Added to the writer's request when a first draft failed the checks.
export function rewriteNotes(issues: ScriptIssue[]): string {
  return [
    "A first draft of this episode failed these checks. Write a fresh script that fixes them:",
    ...issues.map((i) => `- ${i.message}`),
  ].join("\n");
}
