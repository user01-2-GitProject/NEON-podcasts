import { sql } from "@/lib/db";

export type LlmProvider = "anthropic" | "openrouter";

// Keys we store in app_settings. Keep this list small and explicit.
export const SETTING_KEYS = {
  llmProvider: "llm_provider",
  openRouterApiKey: "openrouter_api_key",
  openRouterModel: "openrouter_model",
} as const;

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

// Mask a secret for display: keep a short prefix + last 4 chars.
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
