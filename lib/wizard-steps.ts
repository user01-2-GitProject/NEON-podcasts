// All the questions the show-setup wizard asks, in order, from the spec
// (https://claude.ai/artifact/UdfmFV6Nnf16j1UvhWuS2H). Each question is small
// and finger-friendly; everything is skippable except the show name. A `when`
// filter branches on earlier answers (for example, true-crime-only questions).
//
// The whole list is data, so extra questions can be added without touching
// the component. composeWizardBody() turns the answers into the show brief
// markdown the writer reads before every episode.

import { SHOW_FORMATS } from "@/lib/show-formats";

export type WizardType = "text" | "textarea" | "choice" | "scale" | "yesno";

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
  // Section heading the body groups the answer under (markdown ## heading).
  // Answers with the same section are joined into one paragraph each.
  section?: string;
}

export interface WizardDraft {
  title: string;
  host_count: 1 | 2;
  format: string;
  // All other answers live here, keyed by step id.
  answers: Record<string, string>;
}

export const EMPTY_WIZARD: WizardDraft = { title: "", host_count: 1, format: "", answers: {} };

const isFormat = (d: WizardDraft, ...ids: string[]) => ids.includes(d.format);

export const WIZARD_STEPS: WizardStep[] = [
  // --- Screen 1: the identity of the show ---
  { id: "title", type: "text", required: true, question: "What's your show called?", help: "You can change it later.", placeholder: "e.g. Sunday Morning Markets" },
  { id: "host_count", type: "choice", question: "How many hosts?", help: "One is simpler; two sound like a conversation.", choices: ["One host", "Two hosts"] },
  { id: "format", type: "choice", question: "What kind of show?", help: "Pick what's closest. You can change it later.", choices: SHOW_FORMATS.map((f) => f.label) },

  // --- Content: what the show is ---
  { id: "about", type: "textarea", question: "What's it about, in one sentence?", placeholder: "e.g. A daily rundown of what moved the stock market.", section: "About the show" },
  { id: "audience", type: "text", question: "Who's it for?", placeholder: "e.g. Casual investors who don't watch the market all day", section: "Who it's for" },
  { id: "takeaway", type: "text", question: "What should listeners get out of it?", placeholder: "e.g. Feel caught up in 5 minutes", section: "What listeners get" },
  { id: "where", type: "text", question: "Where in the world?", help: "Only if it matters.", placeholder: "e.g. United States, or Washington DC", section: "Setting" },
  { id: "when_period", type: "text", question: "What time period?", help: "Only if it matters.", placeholder: "e.g. Today, or the 1930s", section: "Setting" },

  // --- Voice & feel ---
  { id: "tone", type: "text", question: "How should it sound?", placeholder: "e.g. Casual and funny, like two friends talking", section: "Voice & style" },
  { id: "serious", type: "scale", question: "How serious?", min: 1, max: 5, minLabel: "Playful", maxLabel: "Serious", section: "Voice & style" },
  { id: "explicit", type: "choice", question: "Clean or explicit?", choices: ["Clean (safe for anyone)", "Occasional strong language", "Explicit"], section: "Voice & style" },
  { id: "graphic", type: "scale", question: "How graphic can it be?", help: "Detail about violence or gore.", min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very", when: (d) => isFormat(d, "truecrime"), section: "Voice & style" },
  { id: "depth", type: "scale", question: "How deep?", help: "Surface summary or detailed analysis.", min: 1, max: 5, minLabel: "Skim the surface", maxLabel: "Deep dive", section: "Voice & style" },
  { id: "knowledge", type: "text", question: "What do listeners already know?", help: "So the host doesn't over-explain basics.", placeholder: "e.g. They watch some news but aren't experts", section: "Voice & style" },

  // --- Facts, sources and truth ---
  { id: "numbers", type: "yesno", question: "Should the host use numbers and stats?", help: "A yes means the writer looks them up and reads them.", section: "Facts & sources" },
  { id: "cite_sources", type: "yesno", question: "Say where facts come from?", help: "Like 'per AP' or 'according to Reuters'.", section: "Facts & sources" },
  { id: "truth", type: "choice", question: "True or made up?", choices: ["All true", "Mostly true with some imagined scenes", "Fully fictional"], section: "Facts & sources" },

  // --- News-specific ---
  { id: "news_which", type: "text", question: "Which news?", help: "Topic, region, or publishers you want covered.", placeholder: "e.g. US national headlines, plus DC local", when: (d) => isFormat(d, "news"), section: "News" },
  { id: "news_count", type: "scale", question: "How many stories per episode?", min: 1, max: 10, minLabel: "1", maxLabel: "10", when: (d) => isFormat(d, "news"), section: "News" },
  { id: "news_feelgood", type: "yesno", question: "End on a feel-good story?", when: (d) => isFormat(d, "news"), section: "News" },

  // --- Markets-specific ---
  { id: "markets_which", type: "text", question: "Which markets?", help: "Stocks, crypto, bonds; which indexes.", placeholder: "e.g. S&P 500 and Nasdaq", when: (d) => isFormat(d, "markets"), section: "Markets" },
  { id: "markets_other_idx", type: "yesno", question: "Other indexes only when they move a lot?", when: (d) => isFormat(d, "markets"), section: "Markets" },
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
  { id: "talk_bits", type: "text", question: "Any running bits?", help: "A segment the show does every time.", placeholder: "e.g. 'Hot take of the week'", when: (d) => isFormat(d, "talk"), section: "Banter" },

  // --- Episode shape ---
  { id: "length", type: "choice", question: "How long?", choices: ["About 5 minutes", "About 10 minutes", "About 15 minutes", "About 20 minutes", "About 30 minutes", "About 45 minutes", "About 60 minutes"], section: "Episode shape" },
  { id: "flow", type: "text", question: "How should it flow?", help: "In your own words, or leave blank for a sensible default.", placeholder: "e.g. Short intro, three segments, wrap-up", section: "Episode shape" },
  { id: "teaser", type: "yesno", question: "Start with a teaser?", help: "A 10-second preview of what's coming.", section: "Episode shape" },
  { id: "open", type: "text", question: "How should it open?", placeholder: "e.g. 'Good morning, it's Tuesday...'", section: "Episode shape" },
  { id: "close", type: "text", question: "How should it end?", placeholder: "e.g. 'See you tomorrow'", section: "Episode shape" },
  { id: "signoff", type: "text", question: "A sign-off line?", placeholder: "e.g. 'Stay sharp.'", section: "Episode shape" },
  { id: "second_person", type: "yesno", question: "Talk to the listener as 'you'?", section: "Episode shape" },
  { id: "say_date", type: "yesno", question: "Say today's date at the start?", section: "Episode shape" },

  // --- Schedule ---
  { id: "cadence", type: "choice", question: "How often?", choices: ["Twice a day", "Every day", "Weekdays only", "Twice a week", "Once a week", "Manually"], section: "Schedule" },
  { id: "schedule_time", type: "text", question: "What time?", help: "Local time. Only if the cadence isn't Manual.", placeholder: "e.g. 06:00", section: "Schedule" },

  // --- Source material ---
  { id: "sources_basis", type: "textarea", question: "What should episodes be based on?", help: "Your notes, a book, a website, a live search.", placeholder: "e.g. The commanders.com blog and this week's game stats", section: "Source material" },
  { id: "sources_reuse", type: "choice", question: "Use these for every episode or just the next?", choices: ["Every episode", "Just the next one"], section: "Source material" },

  // --- Host persona ---
  { id: "host_age", type: "text", question: "How old do the hosts sound?", placeholder: "e.g. 30s", section: "Hosts" },
  { id: "host_inspired", type: "text", question: "Inspired by anyone?", placeholder: "e.g. Ira Glass but less scripted", section: "Hosts" },
  { id: "host_backstory", type: "text", question: "A bit of backstory?", help: "Only if it would change how they talk.", placeholder: "e.g. Grew up in Detroit, worked in finance", section: "Hosts" },

  // --- Two-host specifics ---
  { id: "hosts_dynamic", type: "text", question: "How do the hosts work together?", placeholder: "e.g. One asks, one explains", when: (d) => d.host_count === 2, section: "Hosts" },
  { id: "hosts_disagree", type: "scale", question: "How often do they disagree?", min: 1, max: 5, minLabel: "Never", maxLabel: "Always", when: (d) => d.host_count === 2, section: "Hosts" },
  { id: "hosts_turns", type: "text", question: "Who opens and who closes?", placeholder: "e.g. Sterling opens, Ellen closes", when: (d) => d.host_count === 2, section: "Hosts" },

  // --- Humor ---
  { id: "humor", type: "scale", question: "How much humor?", min: 1, max: 5, minLabel: "None", maxLabel: "A lot", section: "Voice & style" },

  // --- Weight & rules ---
  { id: "important", type: "textarea", question: "What is most important to you about this show?", help: "The writer weighs this most. See 'What matters most' in the brief.", placeholder: "e.g. The family is safe, and everyone finishes already looking forward to Saturday." },
  { id: "rules", type: "textarea", question: "Any hard-line rules?", help: "Things the show must never do.", placeholder: "e.g. Never take a political side. Never share listener names." },

  // --- Research ---
  { id: "lookup", type: "textarea", question: "What should we look up before each episode?", help: "Leave blank if your own files are enough. Each look-up costs about a cent.", placeholder: "e.g. This week's Commanders news and Sunday's game time.\nSites: commanders.com, espn.com" },

  // --- Finish ---
  { id: "preview", type: "yesno", question: "Make the first full episode now?", help: "You can also do this later from the show page." },
];

export function visibleSteps(draft: WizardDraft): WizardStep[] {
  return WIZARD_STEPS.filter((s) => !s.when || s.when(draft));
}

// Turns answers into the show brief body, grouped by section.
export function composeWizardBody(draft: WizardDraft): string {
  const bySection = new Map<string, string[]>();
  for (const step of visibleSteps(draft)) {
    if (!step.section) continue;
    const v = draft.answers[step.id];
    if (!v || !v.trim()) continue;
    const line = formatAnswer(step, v);
    const arr = bySection.get(step.section) ?? [];
    arr.push(line);
    bySection.set(step.section, arr);
  }
  const parts: string[] = [];
  for (const [section, lines] of bySection) parts.push(`## ${section}\n${lines.join("\n")}`);
  // "What matters most" and "Look up before each episode" keep the exact
  // headings the writer and look-up code read (lib/claude.ts, lib/research.ts).
  const imp = draft.answers.important?.trim();
  if (imp) parts.push(`## What matters most\n${imp}`);
  const rules = draft.answers.rules?.trim();
  if (rules) parts.push(`## Hard rules\n${rules}`);
  const look = draft.answers.lookup?.trim();
  if (look) parts.push(`## Look up before each episode\n${look}`);
  return parts.join("\n\n");
}

function formatAnswer(step: WizardStep, v: string): string {
  const val = v.trim();
  if (step.type === "yesno") return `- ${step.question} ${val === "yes" ? "Yes" : "No"}`;
  if (step.type === "scale") return `- ${step.question} ${val}/${step.max ?? 5}${step.maxLabel ? ` (${step.minLabel} to ${step.maxLabel})` : ""}`;
  // Most text answers drop the question and read as a short paragraph.
  if (step.type === "textarea") return val;
  return `- ${step.question} ${val}`;
}

// A small placeholder episode-length string ("About 10 minutes") → 10.
export function minutesFromLengthAnswer(ans: string | undefined, fallback = 10): number {
  if (!ans) return fallback;
  const m = /(\d+)/.exec(ans);
  return m ? Number(m[1]) : fallback;
}

// Map the cadence choice label to the stored cadence id.
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
