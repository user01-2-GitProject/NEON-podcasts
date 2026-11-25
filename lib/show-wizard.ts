// Plain-question new-show flow. The answers become the same show brief a
// show.md body holds, so the prompt and the .md export don't change.
// Pure: shared by the form and the tests.

export interface GuidedAnswers {
  about: string;
  audience: string;
  tone: string;
  important?: string;
  lookup?: string;
}

export const EMPTY_ANSWERS: GuidedAnswers = { about: "", audience: "", tone: "", important: "", lookup: "" };

export const TONE_IDEAS = ["Casual and funny", "Straight news", "Calm and thoughtful", "Hype and high energy"];

export function composeBody(a: GuidedAnswers): string {
  const parts: string[] = [];
  if (a.about.trim()) parts.push(`## About the show\n${a.about.trim()}`);
  if (a.audience.trim()) parts.push(`## Who it's for\n${a.audience.trim()}`);
  if (a.tone.trim()) parts.push(`## Voice & style\n${a.tone.trim()}`);
  // Both headings are read by the app: lib/claude.ts mostImportant() and
  // lib/research.ts researchBrief().
  if (a.important?.trim()) parts.push(`## What matters most\n${a.important.trim()}`);
  if (a.lookup?.trim()) parts.push(`## Look up before each episode\n${a.lookup.trim()}`);
  return parts.join("\n\n");
}

// Short line shown under the title when no motto was given: the first
// sentence of "what's it about", capped.
export function taglineFrom(about: string, max = 140): string {
  const flat = about.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

// Artwork link as typed: a web link is kept (https:// added if missing);
// anything else ("TBD", "none", blank) means no artwork yet.
export function cleanImageUrl(input: string): string {
  const v = input.trim();
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(v)) return `https://${v}`;
  return "";
}
