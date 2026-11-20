import { NextResponse } from "next/server";
import {
  getSettings,
  setSettings,
  maskSecret,
  SETTING_KEYS,
  type LlmProvider,
} from "@/lib/settings";

export const runtime = "nodejs";

// Returns the current, effective LLM settings. The raw OpenRouter key is NEVER
// returned — only whether one is set, where it comes from, and a masked hint.
export async function GET() {
  const s = await getSettings();

  const dbKey = s[SETTING_KEYS.openRouterApiKey] || null;
  const envKey = process.env.OPENROUTER_API_KEY || null;

  const provider =
    (s[SETTING_KEYS.llmProvider] || process.env.LLM_PROVIDER || "anthropic").toLowerCase() ===
    "openrouter"
      ? "openrouter"
      : "anthropic";

  return NextResponse.json({
    provider,
    openrouter_model: s[SETTING_KEYS.openRouterModel] || process.env.OPENROUTER_MODEL || "",
    // Key status, no secret leakage.
    openrouter_key_set: Boolean(dbKey || envKey),
    openrouter_key_source: dbKey ? "settings" : envKey ? "env" : "none",
    openrouter_key_hint: maskSecret(dbKey),
    provider_source: s[SETTING_KEYS.llmProvider] ? "settings" : process.env.LLM_PROVIDER ? "env" : "default",
    model_source: s[SETTING_KEYS.openRouterModel] ? "settings" : process.env.OPENROUTER_MODEL ? "env" : "default",
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, string | null> = {};

  // Provider
  if (typeof body.provider === "string") {
    const p: LlmProvider = body.provider === "openrouter" ? "openrouter" : "anthropic";
    updates[SETTING_KEYS.llmProvider] = p;
  }

  // OpenRouter model (empty string clears back to env/default)
  if (typeof body.openrouter_model === "string") {
    const m = body.openrouter_model.trim();
    updates[SETTING_KEYS.openRouterModel] = m === "" ? null : m;
  }

  // OpenRouter key: only overwrite when a non-empty value is sent. A separate
  // clear flag removes the stored key (falls back to env, if any).
  if (body.clear_openrouter_api_key === true) {
    updates[SETTING_KEYS.openRouterApiKey] = null;
  } else if (typeof body.openrouter_api_key === "string" && body.openrouter_api_key.trim() !== "") {
    updates[SETTING_KEYS.openRouterApiKey] = body.openrouter_api_key.trim();
  }

  if (Object.keys(updates).length > 0) {
    await setSettings(updates);
  }

  // Return the fresh, masked view.
  return GET();
}
