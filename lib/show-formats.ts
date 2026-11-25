// Show formats the wizard offers on screen 1. Each lists a recipe (prompt
// pattern) the writer uses; a format with no recipe yet is NOT offered so
// no one picks a show the app can't make well. "Other" is a free-text fallback.
//
// Adding a format: write its recipe in lib/claude.ts (scriptSystemPrompt), add
// its branch questions in lib/show-wizard.ts, then list it here.

export interface ShowFormat {
  id: string;
  label: string;
  // One-line description shown under the label on the picker.
  description: string;
  // Default host persona for a quick finish; the owner can still change it.
  defaultHostName?: string;
  defaultVoice?: string;
}

export const SHOW_FORMATS: ShowFormat[] = [
  { id: "news", label: "News", description: "What happened today, read calmly.", defaultHostName: "Sterling", defaultVoice: "onyx" },
  { id: "markets", label: "Markets", description: "A short rundown of what moved today.", defaultHostName: "Sterling", defaultVoice: "onyx" },
  { id: "history", label: "History", description: "One story from the past, well told.", defaultHostName: "Arthur", defaultVoice: "fable" },
  { id: "talk", label: "Banter / talk", description: "Two hosts riffing on the week.", defaultHostName: "Ellen", defaultVoice: "coral" },
  { id: "truecrime", label: "True crime", description: "A case, laid out piece by piece.", defaultHostName: "Charles", defaultVoice: "onyx" },
  { id: "madeup", label: "Made-up story", description: "A short fiction serial.", defaultHostName: "Nora", defaultVoice: "nova" },
  { id: "other", label: "Other", description: "Something else. We'll keep it simple.", defaultHostName: "Sterling", defaultVoice: "onyx" },
];

export function isShowFormat(x: unknown): x is ShowFormat["id"] {
  return typeof x === "string" && SHOW_FORMATS.some((f) => f.id === x);
}
