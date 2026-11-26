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

// Editing an existing show: split its brief back into the plain questions so
// the edit form opens with every answer filled in, not blank boxes. Sections
// the questions don't cover (the wizard's "Format", "Hosts", "Hard rules",
// anything typed by hand) are kept as they are, in order, so saving an edit
// never drops part of the brief.
const ANSWER_HEADINGS: [keyof GuidedAnswers, string][] = [
  ["about", "About the show"],
  ["audience", "Who it's for"],
  ["tone", "Voice & style"],
  ["important", "What matters most"],
  ["lookup", "Look up before each episode"],
];

export interface BriefSection {
  heading: string;
  text: string;
  // Set when this section is filled from (and rebuilt from) a question.
  field?: keyof GuidedAnswers;
}

export interface BriefLayout {
  preamble: string;
  sections: BriefSection[];
}

export function splitBrief(body: string): { answers: GuidedAnswers; layout: BriefLayout } {
  const answers: GuidedAnswers = { ...EMPTY_ANSWERS };
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  const preamble: string[] = [];
  const sections: BriefSection[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    sections.push({ heading: cur.heading, text: cur.lines.join("\n").trim() });
    cur = null;
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      cur = { heading: m[1], lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();
  const taken = new Set<keyof GuidedAnswers>();
  for (const s of sections) {
    const hit = ANSWER_HEADINGS.find(([, h]) => h.toLowerCase() === s.heading.toLowerCase());
    if (!hit || taken.has(hit[0])) continue;
    taken.add(hit[0]);
    s.field = hit[0];
    answers[hit[0]] = s.text;
  }
  return { answers, layout: { preamble: preamble.join("\n").trim(), sections } };
}

// Put the brief back together with the current answers in their old places.
// An emptied answer drops its section; a newly filled one is added at the end.
export function joinBrief(layout: BriefLayout, a: GuidedAnswers): string {
  const parts: string[] = [];
  if (layout.preamble) parts.push(layout.preamble);
  const placed = new Set<keyof GuidedAnswers>();
  for (const s of layout.sections) {
    if (s.field) {
      placed.add(s.field);
      const v = (a[s.field] ?? "").trim();
      if (v) parts.push(`## ${s.heading}\n${v}`);
    } else {
      parts.push(s.text ? `## ${s.heading}\n${s.text}` : `## ${s.heading}`);
    }
  }
  for (const [field, heading] of ANSWER_HEADINGS) {
    if (placed.has(field)) continue;
    const v = (a[field] ?? "").trim();
    if (v) parts.push(`## ${heading}\n${v}`);
  }
  return parts.join("\n\n");
}
