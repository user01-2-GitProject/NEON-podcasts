// What a non-technical owner sees in the Voice dropdown. Names match
// OPENAI_VOICES in lib/settings.ts; the description is shown next to each
// name so "Which one is onyx?" is answered without a preview button.
// A local cloned-voice server reuses the same name field (free-type),
// so this list is used only for the hosted-OpenAI picker.

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

// Ready-made hosts to pick from. Each sets the host's name and a sensible
// default voice; the owner can still change either after.
export interface HostPreset {
  id: string;
  label: string;
  name: string;
  voice: string;
}

export const HOST_PRESETS: HostPreset[] = [
  { id: "sterling", label: "Sterling - calm, unbiased news voice", name: "Sterling", voice: "onyx" },
  { id: "ellen", label: "Ellen - warm, friendly", name: "Ellen", voice: "coral" },
  { id: "charles", label: "Charles - deep, serious", name: "Charles", voice: "onyx" },
  { id: "nora", label: "Nora - bright, lively", name: "Nora", voice: "nova" },
  { id: "arthur", label: "Arthur - British, bookish", name: "Arthur", voice: "fable" },
  { id: "sage", label: "Sage - thoughtful, teacherly", name: "Sage", voice: "sage" },
];
