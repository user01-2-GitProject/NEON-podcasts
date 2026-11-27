// All the questions the show-setup wizard asks, in order, from the spec
// (https://claude.ai/artifact/UdfmFV6Nnf16j1UvhWuS2H). Each question is small
// and finger-friendly; everything is skippable except the show name. A `when`
// filter branches on earlier answers (for example, true-crime-only questions).
//
// The whole list is data, so extra questions can be added without touching
// the component. composeWizardBody() turns the answers into the show brief
// markdown the writer reads before every episode.
//
// Nov 25 2026 — jimmy's news-scoped trim against the 85-Q spec:
//   #6 multi-choice takeaway (max 2, conflicting choices grayed out),
//   #7 geo levels, #8 month/daily, new #9 topics, new #12 POV,
//   #16 novice/intermediate/expert, #21 story-count ranges,
//   #23 market asset-classes, #37 bits yes/no.
//   OUT for MVP: episode shape (#38–44: length, flow, teaser, open, close,
//   signoff — NEON plugs are hardcoded) and schedule/sources (#47–52:
//   cadence, time, sources — set on the show page after Create).

import { SHOW_FORMATS } from "@/lib/show-formats";
import { HOST_PRESETS, type HostPreset } from "@/lib/voices";

export type WizardType =
  | "text"
  | "textarea"
  | "choice"
  | "scale"
  | "yesno"
  | "multi"
  | "host";

export interface WizardStep {
  id: string;
  type: WizardType;
  question: string;
  help?: string;
  placeholder?: string;
  choices?: string[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  required?: boolean;
  when?: (draft: WizardDraft) => boolean;
  // For `multi`: how many choices the person can pick before the rest gray out.
  maxPicks?: number;
  // For `multi`: mutually-conflicting sets. Picking a choice grays out every
  // other choice in any set it appears in. Spec example: picking "Laugh" grays
  // out "Stay informed" and "A good story" on the takeaway question.
  conflicts?: string[][];
  // For `text`/`textarea`: per-step cap. Textareas without one get 2000.
  maxLength?: number;
  // Section heading the body groups the answer under (markdown ## heading).
  // Answers with the same section are joined into one paragraph each.
  section?: string;
  // Which tab of the wizard this step belongs to. Defaults to "show".
  tab?: "show" | "host1" | "host2";
}

// The three tabs the wizard walks through, in order.
export const WIZARD_TABS: { id: "show" | "host1" | "host2"; label: string; when?: (d: WizardDraft) => boolean }[] = [
  { id: "show", label: "Show" },
  { id: "host1", label: "Host 1" },
  { id: "host2", label: "Host 2", when: (d) => d.host_count === 2 },
];
export type WizardTabId = "show" | "host1" | "host2";

export interface WizardDraft {
  title: string;
  host_count: 1 | 2;
  format: string;
  // All other answers live here, keyed by step id. For `multi` the value is
  // the picked choices joined with " · " (same separator the spec shows).
  answers: Record<string, string>;
}

export const EMPTY_WIZARD: WizardDraft = { title: "", host_count: 1, format: "", answers: { preview: "yes" } };

const isFormat = (d: WizardDraft, ...ids: string[]) => ids.includes(d.format);

export const WIZARD_STEPS: WizardStep[] = [
  // --- Screen 1: the identity of the show ---
  { id: "title", type: "text", required: true, question: "What's your show called?", help: "You can change it later.", placeholder: "e.g. Sunday Morning Markets" },
  { id: "host_count", type: "choice", question: "How many hosts?", help: "One is simpler; two sound like a conversation.", choices: ["One host", "Two hosts"] },
  { id: "format", type: "choice", question: "What kind of show?", help: "Pick what's closest. You can change it later.", choices: SHOW_FORMATS.map((f) => f.label) },

  // --- Content: what the show is ---
  { id: "about", type: "textarea", question: "What's it about, in one sentence?", placeholder: "e.g. A daily rundown of what moved the stock market.", section: "About the show" },
  { id: "audience", type: "text", question: "Who's it for?", placeholder: "e.g. Casual investors who don't watch the market all day", section: "Who it's for" },
  // "Who's going" — from testing John's show (Nov 25): episodes are often for
  // a specific group (a family trip, a team outing). Names let the host talk
  // to the people who'll actually be there.
  {
    id: "whos_going",
    type: "textarea",
    question: "Who's going?",
    help: "If it's for certain people, like your family or your team, list them. The host can talk to them by name. Skip it if the show is for anyone.",
    placeholder: "e.g. Me, Sarah, and the kids: Ava (8) and Leo (5)",
    section: "Who's going",
  },

  // #6 — pick a couple, conflicting choices gray out.
  {
    id: "takeaway",
    type: "multi",
    question: "What should listeners get out of it?",
    help: "Pick up to two. Some choices will gray out if they'd fight with your first pick.",
    choices: ["Stay informed", "Learn something", "Laugh", "A good story", "Relax", "Get fired up"],
    maxPicks: 2,
    // Humour fights with getting informed and with relaxing; being fired-up fights with relaxing.
    conflicts: [["Laugh", "Stay informed"], ["Laugh", "A good story"], ["Relax", "Get fired up"]],
    section: "What listeners get",
  },

  // #7 — world / country / state / city / zip code.
  {
    id: "where",
    type: "choice",
    question: "Where in the world?",
    help: "Only if it matters.",
    choices: ["Worldwide", "USA", "A state (type it below)", "A city (type it below)", "A ZIP code (type it below)", "Doesn't apply"],
    section: "Setting",
  },
  // Free-text follow-up for the state/city/ZIP picks.
  { id: "where_detail", type: "text", question: "Which state, city or ZIP?", placeholder: "e.g. Michigan, or Detroit, or 48201", when: (d) => /state|city|ZIP/i.test(d.answers.where || ""), section: "Setting" },

  // #8 — month, daily.
  {
    id: "when_period",
    type: "choice",
    question: "What time period?",
    help: "Only if it matters.",
    choices: ["Daily (today's news)", "This week", "This month", "History", "Timeless"],
    section: "Setting",
  },

  // #9/#10 — merged "always cover" + "never touch" into one multi-select
  // "Topics to include". Not picking a chip = don't cover (transcript, Nov 25).
  {
    id: "topics",
    type: "multi",
    question: "Topics to include",
    help: "Tap every topic you want covered. Leave the rest off — they won't be covered.",
    choices: ["Politics", "Sports", "Religion", "Investments", "Weather", "Business / Financial", "Tech", "Science", "Music / Entertainment"],
    section: "Topics",
  },

  // --- Voice & feel ---
  { id: "tone", type: "text", question: "How should it sound?", placeholder: "e.g. Casual and funny, like two friends talking", section: "Voice & style" },
  { id: "serious", type: "scale", question: "How serious?", min: 1, max: 5, minLabel: "Playful", maxLabel: "Serious", section: "Voice & style" },

  // #12 — point of view. Per transcript Matt and jimmy dropped the vague
  // "Has opinions" option and kept Neutral / Both sides / Leans L / Leans R.
  {
    id: "pov",
    type: "choice",
    question: "Point of view",
    choices: ["Neutral", "Both sides", "Leans left", "Leans right"],
    section: "Voice & style",
  },

  { id: "explicit", type: "choice", question: "Clean or explicit?", choices: ["Family friendly", "Some mild language", "Explicit"], section: "Voice & style" },

  // #14 — scale → choice.
  {
    id: "graphic",
    type: "choice",
    question: "How graphic can it be?",
    help: "Detail about violence or gore.",
    choices: ["Keep it light", "Some detail", "Don't hold back"],
    when: (d) => isFormat(d, "truecrime"),
    section: "Voice & style",
  },
  // #15 — scale → choice.
  {
    id: "depth",
    type: "choice",
    question: "How deep?",
    choices: ["Quick overview", "Some detail", "Deep dive"],
    section: "Voice & style",
  },

  // #16 — wording from the transcript (jimmy flagged it to reword later).
  {
    id: "knowledge",
    type: "choice",
    question: "What do listeners already know?",
    help: "So the host doesn't over-explain basics.",
    choices: ["Nothing", "The basics", "A lot"],
    section: "Voice & style",
  },

  // --- Facts, sources ---
  // #17 — yes/no → choice.
  {
    id: "numbers",
    type: "choice",
    question: "Should the host use numbers and stats?",
    choices: ["Rarely", "When they help", "All of them"],
    section: "Facts & sources",
  },
  // #18 — yes/no → choice.
  {
    id: "cite_sources",
    type: "choice",
    question: "Say where facts come from?",
    help: "Like 'per AP' or 'according to Reuters'.",
    choices: ["Always", "Sometimes", "Never"],
    section: "Facts & sources",
  },
  // Follow-up: which sources, if any. Shown only when the owner wants
  // citations at all (Always or Sometimes). Leave blank = let NEON pick.
  {
    id: "cite_sources_which",
    type: "textarea",
    question: "Which sources should the host name?",
    help: "One per line. Leave blank and NEON picks from the look-up results.",
    placeholder: "AP\nReuters\nThe Commanders' official site",
    when: (d) => {
      const v = (d.answers.cite_sources || "").toLowerCase();
      return v === "always" || v === "sometimes";
    },
    section: "Facts & sources",
  },
  // #19 "True or made up?" — OUT (repetitive once topics drive source quality).

  // --- News-specific ---
  // #20 news_which — OUT (the topics multi-select covers it).
  // #21 — Matt pushed for a clickable 1–10 picker; the scale control already
  // renders exactly that.
  { id: "news_count", type: "scale", question: "How many stories per episode?", min: 1, max: 10, minLabel: "1", maxLabel: "10", when: (d) => isFormat(d, "news"), section: "News" },
  // #22 news_feelgood — OUT ("I hate the question", Matt).

  // --- Markets-specific ---
  // #23 — the six buckets Matt and jimmy landed on.
  {
    id: "markets_which",
    type: "multi",
    question: "Which markets?",
    help: "Pick all that apply.",
    choices: ["Indexes", "Commodities", "Crypto", "Bond market", "Real estate", "Stocks"],
    when: (d) => isFormat(d, "markets"),
    section: "Markets",
  },
  // #24 markets_other_idx — OUT (transcript: "stupid question, let's move on").
  { id: "markets_wl", type: "yesno", question: "Biggest winner and loser of the day?", when: (d) => isFormat(d, "markets"), section: "Markets" },

  // --- History-specific ---
  { id: "history_era", type: "text", question: "Which era?", placeholder: "e.g. 20th century, or ancient Rome", when: (d) => isFormat(d, "history"), section: "History" },
  { id: "history_where", type: "text", question: "Which part of the world?", placeholder: "e.g. North America, or global", when: (d) => isFormat(d, "history"), section: "History" },
  { id: "history_theme", type: "text", question: "A theme?", help: "Only if there is one.", placeholder: "e.g. Women rarely made history", when: (d) => isFormat(d, "history"), section: "History" },
  { id: "history_count", type: "choice", question: "One story or several per episode?", choices: ["One story", "A few short stories"], when: (d) => isFormat(d, "history"), section: "History" },

  // --- True crime ---
  { id: "crime_which", type: "text", question: "Which cases?", help: "Unsolved, serial, financial, local, your choice.", placeholder: "e.g. unsolved US cases from the last 30 years", when: (d) => isFormat(d, "truecrime"), section: "True crime" },
  { id: "crime_era", type: "text", question: "Which era?", placeholder: "e.g. 1970s to today", when: (d) => isFormat(d, "truecrime"), section: "True crime" },

  // --- Made-up story ---
  { id: "fiction_genre", type: "text", question: "What genre?", placeholder: "e.g. Noir, fantasy, sci-fi, slice-of-life", when: (d) => isFormat(d, "madeup"), section: "Made-up story" },
  { id: "fiction_shape", type: "choice", question: "One long story or a new one each time?", choices: ["One long story in chapters", "A new story every episode"], when: (d) => isFormat(d, "madeup"), section: "Made-up story" },
  { id: "fiction_recurring", type: "yesno", question: "Same main characters every time?", when: (d) => isFormat(d, "madeup"), section: "Made-up story" },

  // --- Banter / talk ---
  { id: "talk_age", type: "text", question: "What age is it for?", placeholder: "e.g. 25-45", when: (d) => isFormat(d, "talk"), section: "Banter" },
  { id: "talk_topics", type: "textarea", question: "What do the hosts talk about?", placeholder: "e.g. The week in tech news, plus whatever we've been watching", when: (d) => isFormat(d, "talk"), section: "Banter" },
  // #37 — yes/no (with a type-it follow-up if yes).
  { id: "talk_bits", type: "yesno", question: "Any running bits?", help: "A segment the show does every time.", when: (d) => isFormat(d, "talk"), section: "Banter" },
  { id: "talk_bits_which", type: "text", question: "What are the running bits?", placeholder: "e.g. 'Hot take of the week'", when: (d) => isFormat(d, "talk") && d.answers.talk_bits === "yes", section: "Banter" },

  // --- Episode shape — pared to the two spec "always on" bits plus length.
  // #39–44 (flow, teaser, open, close, signoff) are OUT for MVP: NEON opens
  // and closes every episode with a hardcoded plug. Length is asked again
  // (jimmy, Nov 26) — the writer honors the picked minutes.
  {
    id: "length",
    type: "choice",
    question: "How long is each episode?",
    help: "A rough target — the writer aims for this, actual length varies.",
    choices: ["About 5 minutes", "About 10 minutes", "About 20 minutes", "About 30 minutes", "About 45 minutes", "About 60 minutes"],
    section: "Episode shape",
  },
  { id: "second_person", type: "yesno", question: "Talk to the listener as 'you'?", section: "Episode shape" },
  { id: "say_date", type: "yesno", question: "Say today's date at the start?", section: "Episode shape" },

  // --- Schedule / sources / hosts persona / 2-host dynamics ---
  // #47–52 (cadence, time, sources, reuse, pronunciations) are OUT for MVP:
  // owners set them on the show page after Create.

  // --- Host persona ---
  // #54 host_age OUT (transcript: only ~3 canned voices in MVP, can't change age).
  // #60–63 OUT for MVP (inspired-by, catchphrases, never-say, backstory).

  // --- Two-host specifics (Host 2 tab) ---
  // One-tap hosts (jimmy + Matt, Nov 24): pick a ready-made host or build one.
  { id: "host2_preset", type: "host", question: "Who's the second host?", help: "Tap one to use them as they are. You can change anything later.", when: (d) => d.host_count === 2, tab: "host2", section: "Host 2" },
  { id: "host2_name", type: "text", question: "What's the second host's name?", placeholder: "e.g. Maya", maxLength: 40, required: true, when: (d) => d.host_count === 2, tab: "host2" },
  // #75 — add "Professional" and "Mentor / student" (transcript).
  {
    id: "hosts_dynamic",
    type: "choice",
    question: "How do the hosts work together?",
    choices: ["Banter", "One leads, one asks", "They debate", "Expert and beginner", "Mentor and student", "Professional"],
    when: (d) => d.host_count === 2,
    tab: "host2",
    section: "Hosts",
  },
  // #76 — "A lot" → "Often".
  {
    id: "hosts_disagree",
    type: "choice",
    question: "How often do they disagree?",
    choices: ["Never", "Sometimes", "Often"],
    when: (d) => d.host_count === 2,
    tab: "host2",
    section: "Hosts",
  },
  // #77 — repurposed: segment format.
  {
    id: "hosts_segments",
    type: "choice",
    question: "Segment format",
    help: "Hosts take segments one after the other, or talk through them together.",
    choices: ["Sequentially", "Conversationally"],
    when: (d) => d.host_count === 2,
    tab: "host2",
    section: "Hosts",
  },
  { id: "anything_host2", type: "textarea", question: "Anything else about host 2?", help: "Same as host 1 — backstory, voice, catchphrases.", placeholder: "e.g. Softer voice, asks the questions. Grew up listening to late-night radio.", maxLength: 5000, when: (d) => d.host_count === 2, tab: "host2", section: "Host 2" },

  // --- Humor ---
  { id: "humor", type: "scale", question: "How much humor?", min: 1, max: 5, minLabel: "None", maxLabel: "A lot", section: "Voice & style" },

  // --- Speech speed — a new one (jimmy, Nov 25).
  {
    id: "speech_speed",
    type: "choice",
    question: "How fast should they talk?",
    help: "Concise skips the fluff; the x2/x3 options cram more into the same minutes.",
    choices: ["Normal", "Concise", "Fast (about 2x)", "Very fast (about 3x)"],
    section: "Voice & style",
  },

  // --- Weight & rules ---
  { id: "important", type: "textarea", question: "What is most important to you about this show?", help: "The writer weighs this most. See 'What matters most' in the brief.", placeholder: "e.g. The family is safe, and everyone finishes already looking forward to Saturday." },
  { id: "rules", type: "textarea", question: "Any hard-line rules?", help: "Things the show must never do.", placeholder: "e.g. Never take a political side. Never share listener names." },

  // --- Tricky words (optional). Not part of the brief: ShowWizard turns it
  // into the show's tricky-words list (lib/pronounce parseTrickyWords).
  { id: "tricky_words", type: "textarea", question: "Any words the host might say wrong?", help: "Player names, short forms like RBI, or words like \"rebound\". One per line: word = how to say it. Not sure? Skip it, you can add these later.", placeholder: "e.g. rebound = REE-bound\nRBI = R B I", maxLength: 3000 },

  // --- End-of-tab free text (jimmy + Matt, Nov 25): up to 5,000 characters ---
  { id: "anything_show", type: "textarea", question: "Anything else about the show?", help: "A paragraph in your own words. Not a prompt — this is context NEON uses, the host won't read it out.", placeholder: "e.g. Stay unbiased. It's fine to say which way each party leans, but what I want to understand is the issue.", maxLength: 5000, section: "Anything else about the show" },

  // --- Host 1 tab ---
  // (The host2 steps — hosts_dynamic, hosts_disagree, hosts_segments,
  // anything_host2 — live earlier in this array and carry tab: "host2".)
  // One-tap hosts (jimmy + Matt, Nov 24): Sterling first, or build your own.
  { id: "host1_preset", type: "host", question: "Pick your host", help: "Tap one to use them as they are. You can change anything later.", tab: "host1", section: "Host 1" },
  { id: "host1_name", type: "text", question: "What's your host's name?", placeholder: "e.g. Maya", maxLength: 40, required: true, tab: "host1" },
  { id: "anything_host1", type: "textarea", question: "Anything else about host 1?", help: "Backstory, voice tweaks, a catchphrase — anything the writer should know.", placeholder: "e.g. Grew up in Detroit, finance background, dry wit. Loves a short pause for effect.", maxLength: 5000, tab: "host1", section: "Host 1" },
];

// The "host" step's value: a HOST_PRESETS id, or CUSTOM_HOST to build one.
export const CUSTOM_HOST = "custom";

export function hostPreset(id: string | undefined): HostPreset | undefined {
  return id ? HOST_PRESETS.find((h) => h.id === id) : undefined;
}

// The host a wizard draft ends up with, for slot 1 or 2. Names are always user
// input; presets only provide a starting voice/persona.
export function wizardHost(draft: WizardDraft, slot: 1 | 2): { name: string; voice: string } {
  const a = draft.answers;
  const picked = a[`host${slot}_preset`];
  const preset = hostPreset(picked);
  const format = SHOW_FORMATS.find((f) => f.id === draft.format);
  const fallback = slot === 1 ? hostPreset(format?.defaultHostName?.toLowerCase()) ?? HOST_PRESETS[0] : undefined;
  const name = a[`host${slot}_name`]?.trim() || "";
  const voice = a[`host${slot}_voice`]?.trim() || preset?.voice || (slot === 1 ? fallback?.voice ?? "" : "");
  return { name, voice };
}

export function visibleSteps(draft: WizardDraft): WizardStep[] {
  return WIZARD_STEPS.filter((s) => !s.when || s.when(draft));
}

// Groups visibleSteps by tab, in tab order. A hidden tab (e.g. host2 for a
// one-host draft) is dropped entirely.
export function stepsByTab(draft: WizardDraft): { tab: typeof WIZARD_TABS[number]; steps: WizardStep[] }[] {
  const steps = visibleSteps(draft);
  const out: { tab: typeof WIZARD_TABS[number]; steps: WizardStep[] }[] = [];
  for (const tab of WIZARD_TABS) {
    if (tab.when && !tab.when(draft)) continue;
    const forTab = steps.filter((s) => (s.tab || "show") === tab.id);
    if (forTab.length) out.push({ tab, steps: forTab });
  }
  return out;
}

export function wizardProgress(stepId: string): { current: number; total: number } {
  const index = WIZARD_STEPS.findIndex((step) => step.id === stepId);
  return { current: index >= 0 ? index + 1 : 1, total: WIZARD_STEPS.length };
}

// Complete answer preview for the review screen. Skipped and
// empty answers are left out.
export function reviewLines(draft: WizardDraft): { step: WizardStep; line: string }[] {
  const out: { step: WizardStep; line: string }[] = [];
  for (const step of visibleSteps(draft)) {
    const v = step.id === "title" ? draft.title : draft.answers[step.id];
    if (!v || !v.trim()) continue;
    out.push({ step, line: previewLine(step, v) });
  }
  return out;
}

function previewLine(step: WizardStep, v: string): string {
  const val = v.trim();
  if (step.type === "yesno") return val === "yes" ? "Yes" : "No";
  if (step.type === "scale") return `${val} out of ${step.max ?? 5}${step.maxLabel ? ` (${step.minLabel} → ${step.maxLabel})` : ""}`;
  if (step.type === "multi") return val;
  if (step.type === "host") return val === CUSTOM_HOST ? "Building my own" : hostPreset(val)?.label ?? val;
  // text / textarea / choice — keep the complete answer for review.
  return val;
}

// The owner's title is used as-is (jimmy, Nov 26: the N.E.O.N. prefix looked
// stupid in listings). We also strip a "N.E.O.N. -" dash-prefix if one slipped
// in from the old behavior, so edits of older shows come out clean. A title
// that just starts with "NEON" (no dash) is left alone.
export function brandedTitle(raw: string): string {
  return raw.replace(/^\s*N\.?\s*E\.?\s*O\.?\s*N\.?\s*[-–—]\s*/i, "").trim();
}

// Which choices on a `multi` step should be grayed out, given the current pick.
// A choice is grayed when:
//   - it is already picked (so can't be picked again), OR
//   - another picked choice is in the same `conflicts` set, OR
//   - the maxPicks cap is reached and this choice isn't already picked.
export function grayedChoices(step: WizardStep, picked: string[]): string[] {
  if (step.type !== "multi") return [];
  const out = new Set<string>();
  const sets = step.conflicts || [];
  const cap = step.maxPicks ?? Infinity;
  for (const choice of step.choices || []) {
    if (picked.includes(choice)) continue; // handled by the "selected" state, not gray
    if (picked.length >= cap) { out.add(choice); continue; }
    for (const set of sets) {
      if (set.includes(choice) && set.some((c) => picked.includes(c))) { out.add(choice); break; }
    }
  }
  return [...out];
}

// Multi-pick values are stored joined by " · ". Helpers to read and write.
const MULTI_SEP = " · ";
export function readMulti(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(MULTI_SEP).map((s) => s.trim()).filter(Boolean);
}
export function writeMulti(picks: string[]): string {
  return picks.join(MULTI_SEP);
}

// Turns answers into the show brief body, grouped by section. The format
// comes first so the writer always sees it even when the content questions
// are skipped.
export function composeWizardBody(draft: WizardDraft): string {
  const parts: string[] = [];
  const formatLabel = SHOW_FORMATS.find((f) => f.id === draft.format)?.label;
  if (formatLabel) parts.push(`## Format\n${formatLabel}`);
  const bySection = new Map<string, string[]>();
  for (const step of visibleSteps(draft)) {
    if (!step.section) continue;
    const v = draft.answers[step.id];
    if (!v || !v.trim()) continue;
    const line = formatAnswer(step, v);
    if (!line) continue;
    const arr = bySection.get(step.section) ?? [];
    arr.push(line);
    bySection.set(step.section, arr);
  }
  for (const [section, lines] of bySection) parts.push(`## ${section}\n${lines.join("\n")}`);
  // "What matters most" and "Look up before each episode" keep the exact
  // headings the writer and look-up code read (lib/claude.ts, lib/research.ts).
  const imp = draft.answers.important?.trim();
  if (imp) parts.push(`## What matters most\n${imp}`);
  const rules = draft.answers.rules?.trim();
  if (rules) parts.push(`## Hard rules\n${rules}`);
  return parts.join("\n\n");
}

function formatAnswer(step: WizardStep, v: string): string {
  const val = v.trim();
  if (step.type === "yesno") return `- ${step.question} ${val === "yes" ? "Yes" : "No"}`;
  if (step.type === "scale") return `- ${step.question} ${val}/${step.max ?? 5}${step.maxLabel ? ` (${step.minLabel} to ${step.maxLabel})` : ""}`;
  if (step.type === "multi") return `- ${step.question} ${val}`;
  if (step.type === "host") {
    return hostPreset(val)?.persona ?? "";
  }
  // Most text answers drop the question and read as a short paragraph.
  if (step.type === "textarea") return val;
  return `- ${step.question} ${val}`;
}

// An episode-length answer like "About 10 minutes" → 10. Brought back after
// jimmy flagged that the length question was missing (Nov 26) — a skipped
// step still falls back to 10 minutes so Create never breaks.
export function minutesFromLengthAnswer(ans: string | undefined, fallback = 10): number {
  if (!ans) return fallback;
  const m = /(\d+)/.exec(ans);
  return m ? Number(m[1]) : fallback;
}

// Cadence isn't asked in the wizard anymore (#47 out) — owners set it on the
// show page. This helper stays for ShowSpecForm's parser; manual cadence is
// the safe default when the wizard finishes.
const CADENCE_MAP: Record<string, string> = {
  "Twice a day": "twice_daily",
  "Every day": "daily",
  "Weekdays only": "weekdays",
  "Twice a week": "twice_weekly",
  "Once a week": "weekly",
  "Manually": "manual",
};
export function cadenceFromAnswer(ans: string | undefined): string {
  return (ans && CADENCE_MAP[ans]) || "manual";
}

// The format id for a picked format label ("News" → "news").
export function formatIdFromLabel(label: string | undefined): string {
  return SHOW_FORMATS.find((f) => f.label === label)?.id ?? "";
}
