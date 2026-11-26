import { sql } from "@/lib/db";

export type LlmProvider = "anthropic" | "openrouter";

// Keys we store in app_settings. Keep this list small and explicit.
export const SETTING_KEYS = {
  llmProvider: "llm_provider",
  openRouterApiKey: "openrouter_api_key",
  openRouterModel: "openrouter_model",
  ttsProvider: "tts_provider",
  openAiTtsApiKey: "openai_tts_api_key",
  openAiTtsVoice: "openai_tts_voice",
  openAiTtsModel: "openai_tts_model",
} as const;

// "edge" = free Microsoft Edge voices (no key). See lib/voices.ts.
export type TtsProvider = "openai" | "elevenlabs" | "local" | "edge";
export const TTS_PROVIDERS: TtsProvider[] = ["openai", "elevenlabs", "local", "edge"];

// OpenAI's built-in speech voices. A show voice_id outside this list (e.g. a
// local cloned-voice name) falls back to the default voice with OpenAI.
export const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
] as const;
export const DEFAULT_OPENAI_VOICE = "alloy";
export const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

// Read all settings as a plain map. Tolerant of a missing table (returns {})
// so the app still works before the migration has run.
export async function getSettings(): Promise<Record<string, string>> {
  try {
    const rows = (await sql`select key, value from app_settings`) as {
      key: string;
      value: string | null;
    }[];
    const out: Record<string, string> = {};
    for (const r of rows) if (r.value != null && r.value !== "") out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

// Upsert (string) or delete (null) a batch of settings.
export async function setSettings(entries: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) {
      await sql`delete from app_settings where key = ${key}`;
    } else {
      await sql`
        insert into app_settings (key, value, updated_at)
        values (${key}, ${value}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
    }
  }
}

// Effective LLM config: in-app settings override the matching env vars.
export async function resolveLlmConfig(): Promise<{
  provider: LlmProvider;
  openRouterApiKey: string | null;
  openRouterModel: string | null;
}> {
  const s = await getSettings();
  const rawProvider = (s[SETTING_KEYS.llmProvider] || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider: LlmProvider = rawProvider === "openrouter" ? "openrouter" : "anthropic";
  return {
    provider,
    openRouterApiKey: s[SETTING_KEYS.openRouterApiKey] || process.env.OPENROUTER_API_KEY || null,
    openRouterModel: s[SETTING_KEYS.openRouterModel] || process.env.OPENROUTER_MODEL || null,
  };
}

export interface TtsConfig {
  provider: TtsProvider;
  openAiApiKey: string | null;
  openAiVoice: string;
  openAiModel: string;
}

// Effective voice config. In-app settings override env vars, so an owner can
// paste one OpenAI key in Settings and every auto-narrated show gets audio.
export function ttsConfigFrom(s: Record<string, string>, env: Record<string, string | undefined>): TtsConfig {
  const raw = (s[SETTING_KEYS.ttsProvider] || env.TTS_PROVIDER || "openai").toLowerCase();
  const provider = (TTS_PROVIDERS as string[]).includes(raw) ? (raw as TtsProvider) : "openai";
  return {
    provider,
    openAiApiKey: s[SETTING_KEYS.openAiTtsApiKey] || env.OPENAI_API_KEY || null,
    openAiVoice: s[SETTING_KEYS.openAiTtsVoice] || env.OPENAI_TTS_VOICE || DEFAULT_OPENAI_VOICE,
    openAiModel: s[SETTING_KEYS.openAiTtsModel] || env.OPENAI_TTS_MODEL || DEFAULT_OPENAI_TTS_MODEL,
  };
}

export async function resolveTtsConfig(): Promise<TtsConfig> {
  return ttsConfigFrom(await getSettings(), process.env);
}

/** The voice OpenAI should use: the show's voice if it's an OpenAI voice, else the default. */
export function pickOpenAiVoice(showVoice: string | null | undefined, fallback: string): string {
  const v = (showVoice || "").trim().toLowerCase();
  return (OPENAI_VOICES as readonly string[]).includes(v) ? v : fallback;
}

// Mask a secret for display: keep a short prefix + last 4 chars.
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
