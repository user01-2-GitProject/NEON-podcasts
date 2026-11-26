// Every stock voice NEON knows about, from three sources:
//   - "openai": hosted OpenAI voices (paid, needs the key in Settings → Voice).
//     Ids are the bare names ("onyx"), so older shows keep working.
//   - "edge":   free Microsoft Edge read-aloud voices. No key, no account.
//     Ids look like "edge:en-GB-RyanNeural".
//   - "kokoro": free Kokoro voices on your own computer (Kokoro-FastAPI at
//     LOCAL_TTS_URL). Ids look like "kokoro:bm_george".
// lib/tts.ts routes each episode by the id's prefix, so one show can use a
// free voice while another uses OpenAI. Labels are what a non-technical
// owner sees, so "Which one is onyx?" is answered without a preview button.
// This file must stay import-free (the wizard and tests both load it).

export interface VoiceOption {
  id: string;
  label: string;
}

export const OPENAI_VOICE_OPTIONS: VoiceOption[] = [
  { id: "alloy", label: "Alloy - neutral, friendly" },
  { id: "ash", label: "Ash - warm, grounded" },
  { id: "ballad", label: "Ballad - rich, storyteller" },
  { id: "coral", label: "Coral - warm, upbeat (woman)" },
  { id: "echo", label: "Echo - calm, measured" },
  { id: "fable", label: "Fable - soft, British" },
  { id: "nova", label: "Nova - bright, lively (woman)" },
  { id: "onyx", label: "Onyx - deep, authoritative" },
  { id: "sage", label: "Sage - thoughtful, teacherly" },
  { id: "shimmer", label: "Shimmer - clear, cheerful (woman)" },
  { id: "verse", label: "Verse - expressive, dynamic" },
];

// Common IANA time zones for the picker. Any other zone can still be typed
// in; the <datalist> is a hint, not a limit.
export const TIMEZONE_OPTIONS: string[] = [
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Athens",
  "Africa/Johannesburg",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
];

// --- Free voices ------------------------------------------------------------

export type VoiceSource = "openai" | "edge" | "kokoro";

export interface CatalogVoice {
  id: string;
  label: string;
  source: VoiceSource;
  free: boolean;
  gender: "man" | "woman";
  accent: string;
}

const edge = (name: string, label: string, gender: "man" | "woman", accent: string): CatalogVoice => ({
  id: `edge:${name}`,
  label,
  source: "edge",
  free: true,
  gender,
  accent,
});
const kokoro = (name: string, label: string, gender: "man" | "woman", accent: string): CatalogVoice => ({
  id: `kokoro:${name}`,
  label,
  source: "kokoro",
  free: true,
  gender,
  accent,
});

// 25 English Microsoft Edge voices: a spread of accents, ages and moods.
export const EDGE_VOICES: CatalogVoice[] = [
  edge("en-GB-RyanNeural", "Ryan - British man, newsreader", "man", "British"),
  edge("en-GB-ThomasNeural", "Thomas - British man, warm, bookish", "man", "British"),
  edge("en-GB-SoniaNeural", "Sonia - British woman, crisp", "woman", "British"),
  edge("en-GB-LibbyNeural", "Libby - British woman, friendly", "woman", "British"),
  edge("en-US-AndrewNeural", "Andrew - American man, warm, easy", "man", "American"),
  edge("en-US-BrianNeural", "Brian - American man, casual, upbeat", "man", "American"),
  edge("en-US-ChristopherNeural", "Christopher - American man, deep, serious", "man", "American"),
  edge("en-US-GuyNeural", "Guy - American man, radio announcer", "man", "American"),
  edge("en-US-EricNeural", "Eric - American man, calm, plain", "man", "American"),
  edge("en-US-RogerNeural", "Roger - American man, older, steady", "man", "American"),
  edge("en-US-SteffanNeural", "Steffan - American man, clear, smooth", "man", "American"),
  edge("en-US-AvaNeural", "Ava - American woman, warm, bright", "woman", "American"),
  edge("en-US-EmmaNeural", "Emma - American woman, cheerful", "woman", "American"),
  edge("en-US-JennyNeural", "Jenny - American woman, friendly", "woman", "American"),
  edge("en-US-AriaNeural", "Aria - American woman, confident", "woman", "American"),
  edge("en-US-MichelleNeural", "Michelle - American woman, calm", "woman", "American"),
  edge("en-AU-WilliamNeural", "William - Australian man", "man", "Australian"),
  edge("en-AU-NatashaNeural", "Natasha - Australian woman", "woman", "Australian"),
  edge("en-IE-ConnorNeural", "Connor - Irish man", "man", "Irish"),
  edge("en-IE-EmilyNeural", "Emily - Irish woman", "woman", "Irish"),
  edge("en-CA-LiamNeural", "Liam - Canadian man", "man", "Canadian"),
  edge("en-CA-ClaraNeural", "Clara - Canadian woman", "woman", "Canadian"),
  edge("en-IN-PrabhatNeural", "Prabhat - Indian man", "man", "Indian"),
  edge("en-IN-NeerjaNeural", "Neerja - Indian woman", "woman", "Indian"),
  edge("en-ZA-LukeNeural", "Luke - South African man", "man", "South African"),
];

// Kokoro's English voices (Kokoro-FastAPI names). Only listed when the app
// can reach a local voice server (LOCAL_TTS_URL).
export const KOKORO_VOICES: CatalogVoice[] = [
  kokoro("bm_george", "George - British man, distinguished", "man", "British"),
  kokoro("bm_lewis", "Lewis - British man, deep", "man", "British"),
  kokoro("bm_fable", "Fable - British man, storyteller", "man", "British"),
  kokoro("bf_emma", "Emma - British woman, warm", "woman", "British"),
  kokoro("bf_isabella", "Isabella - British woman, poised", "woman", "British"),
  kokoro("am_michael", "Michael - American man, steady", "man", "American"),
  kokoro("am_adam", "Adam - American man, deep", "man", "American"),
  kokoro("am_fenrir", "Fenrir - American man, bold", "man", "American"),
  kokoro("am_puck", "Puck - American man, playful", "man", "American"),
  kokoro("af_heart", "Heart - American woman, warm", "woman", "American"),
  kokoro("af_bella", "Bella - American woman, lively", "woman", "American"),
  kokoro("af_nicole", "Nicole - American woman, soft, close", "woman", "American"),
  kokoro("af_sarah", "Sarah - American woman, clear", "woman", "American"),
];

const OPENAI_GENDER: Record<string, "man" | "woman"> = { coral: "woman", nova: "woman", shimmer: "woman", sage: "woman" };
export const OPENAI_CATALOG: CatalogVoice[] = OPENAI_VOICE_OPTIONS.map((v) => ({
  id: v.id,
  label: v.label,
  source: "openai",
  free: false,
  gender: OPENAI_GENDER[v.id] ?? "man",
  accent: v.id === "fable" ? "British" : "American",
}));

// Free voices first: they cost nothing to try.
export const VOICE_CATALOG: CatalogVoice[] = [...EDGE_VOICES, ...KOKORO_VOICES, ...OPENAI_CATALOG];

// The free voice a show falls back to when no voice is set and the app's
// voice setting is "Free voices".
export const DEFAULT_EDGE_VOICE = "en-US-AndrewNeural";

// Which engine a show's voice id belongs to. Bare Edge names
// ("en-GB-RyanNeural") count as Edge too, so a pasted name just works.
export function voiceSource(voiceId: string | null | undefined): VoiceSource | null {
  const v = (voiceId || "").trim();
  if (!v) return null;
  if (/^edge:/i.test(v) || /^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/.test(v)) return "edge";
  if (/^kokoro:/i.test(v)) return "kokoro";
  if (OPENAI_VOICE_OPTIONS.some((o) => o.id === v.toLowerCase())) return "openai";
  return null; // a local cloned-voice name, or something we don't know
}

/** The engine's own voice name: "edge:en-GB-RyanNeural" → "en-GB-RyanNeural". */
export function voiceName(voiceId: string): string {
  return voiceId.trim().replace(/^(edge|kokoro):/i, "");
}

/** Friendly label for any voice id, for review screens and show pages. */
export function voiceLabel(voiceId: string | null | undefined): string {
  const v = (voiceId || "").trim();
  if (!v) return "Default voice";
  return VOICE_CATALOG.find((c) => c.id === v || c.id === `edge:${v}`)?.label ?? v;
}

// --- One-tap hosts -----------------------------------------------------------

// Ready-made hosts to pick from. Each sets the host's name, a free voice and
// a short persona the writer reads; the owner can still change any of it.
// Sterling is first: the worked example is "Sterling Reads the News".
export interface HostPreset {
  id: string;
  label: string;
  name: string;
  voice: string;
  blurb: string;
  persona: string;
}

export const HOST_PRESETS: HostPreset[] = [
  {
    id: "sterling",
    label: "Sterling - British newsreader, calm, unbiased",
    name: "Sterling",
    voice: "edge:en-GB-RyanNeural",
    blurb: "British man. Calm, polished, never takes sides.",
    persona: "Sterling is a British male newsreader: calm, polished and strictly unbiased. Measured pace, dry understatement, never editorializes.",
  },
  {
    id: "ellen",
    label: "Ellen - warm, friendly",
    name: "Ellen",
    voice: "edge:en-US-AvaNeural",
    blurb: "American woman. Warm, chatty, makes you feel at home.",
    persona: "Ellen is a warm, friendly American host who talks to listeners like old friends and laughs easily.",
  },
  {
    id: "charles",
    label: "Charles - deep, serious",
    name: "Charles",
    voice: "edge:en-US-ChristopherNeural",
    blurb: "American man. Deep voice, serious, great for true crime.",
    persona: "Charles is a deep-voiced, serious American narrator. Careful with facts, builds tension slowly, respectful to victims.",
  },
  {
    id: "nora",
    label: "Nora - bright, lively",
    name: "Nora",
    voice: "edge:en-US-EmmaNeural",
    blurb: "American woman. Bright, upbeat, quick.",
    persona: "Nora is a bright, lively American host: upbeat, curious and quick, with a light sense of humor.",
  },
  {
    id: "arthur",
    label: "Arthur - British, bookish",
    name: "Arthur",
    voice: "edge:en-GB-ThomasNeural",
    blurb: "British man. Warm storyteller, loves history.",
    persona: "Arthur is a warm, bookish British storyteller who loves history and the small human details in it.",
  },
  {
    id: "maeve",
    label: "Maeve - Irish, witty",
    name: "Maeve",
    voice: "edge:en-IE-EmilyNeural",
    blurb: "Irish woman. Witty, warm, a great co-host.",
    persona: "Maeve is a witty, warm Irish host who teases gently and keeps the conversation moving.",
  },
  {
    id: "jack",
    label: "Jack - Aussie, laid back",
    name: "Jack",
    voice: "edge:en-AU-WilliamNeural",
    blurb: "Australian man. Laid back, funny, plain-spoken.",
    persona: "Jack is a laid-back, plain-spoken Australian host with a dry sense of humor.",
  },
  {
    id: "sage",
    label: "Sage - thoughtful, teacherly",
    name: "Sage",
    voice: "edge:en-US-MichelleNeural",
    blurb: "American woman. Calm teacher, explains things simply.",
    persona: "Sage is a calm, thoughtful American host who explains hard things simply, like a favorite teacher.",
  },
];
