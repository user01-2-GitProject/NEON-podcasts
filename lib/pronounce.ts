import type { PronunciationMatchMode } from "@/lib/types";

// "Tricky words": each show keeps a list of words the voice says wrong
// (player names, "rebound", RBI, NEON...) and how they should sound. The list
// is applied to the script text right before it goes to the voice, so the
// stored script and show notes keep the real spelling.
//
// This file is import-free (types only) so the browser can use the parser too.

export interface PronunciationRule {
  term: string;
  say_as: string;
  match_mode: PronunciationMatchMode;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A "word" edge that understands accents, so "Dončić" and "Jokić" match as
// whole words (JavaScript's \b only knows A-Z).
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
// Plurals and possessives ride along: a rule for "rebound" also fixes
// "rebounds" and "rebound's" (the ending is kept after the new spelling).
const WORD_ENDING = "((?:'|’)s|s|es)?(?![\\p{L}\\p{N}_])";

// Apply rules. Case-insensitive. Longer terms go first, so a phrase rule
// ("Deep Fucking Value") wins over a rule for one of its words.
// word mode: whole word (or phrase), plus an optional plural/possessive ending.
// substring mode: anywhere it appears, even inside a longer word.
export function applyPronunciations(script: string, rules: PronunciationRule[]): string {
  const ordered = rules
    .filter((r) => r && r.term && r.term.trim())
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.term.trim().length - a.r.term.trim().length || a.i - b.i)
    .map((x) => x.r);
  // One pass: each match becomes a placeholder, so a respelling is never
  // changed again by a later rule ("rebound" -> "REE-bound" stays put).
  const swaps: string[] = [];
  const hold = (text: string) => {
    swaps.push(text);
    // Index written in private-use characters, which no rule can match.
    const digits = (swaps.length - 1).toString(16).split("").map((d) => String.fromCharCode(0xe100 + parseInt(d, 16)));
    return `\uE000${digits.join("")}\uE001`;
  };
  let out = script;
  for (const rule of ordered) {
    const escaped = escapeRegex(rule.term.trim());
    const sayAs = rule.say_as;
    if (rule.match_mode === "word") {
      const pattern = new RegExp(`${NOT_WORD_BEFORE}${escaped}${WORD_ENDING}`, "giu");
      out = out.replace(pattern, (_m, ending: string | undefined) => hold(sayAs + (ending || "")));
    } else {
      out = out.replace(new RegExp(escaped, "giu"), () => hold(sayAs));
    }
  }
  return out.replace(/\uE000([\uE100-\uE10F]+)\uE001/g, (_m, ds: string) => {
    const n = parseInt(ds.split("").map((c) => (c.charCodeAt(0) - 0xe100).toString(16)).join(""), 16);
    return swaps[n] ?? "";
  });
}

export interface ParsedTrickyWord {
  term: string;
  say_as: string;
  match: "word" | "substring";
}

// One per line: "word = how to say it". Also accepts "=>", "->" and "→".
// A trailing "(substring)" or "(inside words)" fixes it inside longer words too.
// Lines without a separator, or with an empty side, are skipped.
export function parseTrickyWords(text: string): ParsedTrickyWord[] {
  const out: ParsedTrickyWord[] = [];
  const seen = new Set<string>();
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:=>|->|→|=)\s*(.*)$/.exec(line);
    if (!m) continue;
    const term = m[1].trim().replace(/^["']|["']$/g, "");
    let rest = m[2].trim();
    const inside = /\((?:substring|inside words?)\)\s*$/i.test(rest);
    rest = rest.replace(/\((?:substring|inside words?)\)\s*$/i, "").trim().replace(/^["']|["']$/g, "");
    if (!term || !rest) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, say_as: rest, match: inside ? "substring" : "word" });
  }
  return out;
}

export function formatTrickyWords(list: { term: string; say_as: string; match?: string; match_mode?: string }[]): string {
  return list
    .map((p) => `${p.term} = ${p.say_as}${(p.match ?? p.match_mode) === "substring" ? " (inside words)" : ""}`)
    .join("\n");
}

// Words that must never be said on air. A tricky-word rule whose word is one
// of these is a "say this instead" rule: the writer is told to use the
// replacement, and the voice step swaps it as a backstop.
const NEVER_SAY = /\b(?:fuck\w*|motherfuck\w*|shit\w*|bullshit|bitch\w*|cunt\w*|asshole\w*|dickhead\w*|bastard\w*)\b/i;
export function isNeverSay(term: string): boolean {
  return NEVER_SAY.test(term || "");
}
