import type { PronunciationMatchMode } from "@/lib/types";

export interface PronunciationRule {
  term: string;
  say_as: string;
  match_mode: PronunciationMatchMode;
}

// Apply rules in order. Skip rules with an empty term. Case-insensitive.
// word mode: whole-word replace using word boundaries, regex metachars in term escaped.
// substring mode: case-insensitive substring replace.
export function applyPronunciations(script: string, rules: PronunciationRule[]): string {
  let out = script;
  for (const rule of rules) {
    if (!rule.term) continue;
    const escaped = rule.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern =
      rule.match_mode === "word"
        ? new RegExp(`\\b${escaped}\\b`, "gi")
        : new RegExp(escaped, "gi");
    out = out.replace(pattern, rule.say_as);
  }
  return out;
}
