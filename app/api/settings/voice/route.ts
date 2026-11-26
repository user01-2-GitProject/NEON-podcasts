import { NextResponse } from "next/server";
import {
  DEFAULT_OPENAI_VOICE,
  OPENAI_VOICES,
  SETTING_KEYS,
  TTS_PROVIDERS,
  getSettings,
  maskSecret,
  setSettings,
  ttsConfigFrom,
} from "@/lib/settings";
import { ownerId } from "@/lib/token-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function view() {
  const s = await getSettings();
  const cfg = ttsConfigFrom(s, process.env);
  const dbKey = s[SETTING_KEYS.openAiTtsApiKey] || null;
  return {
    provider: cfg.provider,
    openai_voice: cfg.openAiVoice,
    voices: OPENAI_VOICES,
    // The key itself is never returned: only whether it's set, where from, and a hint.
    openai_key_set: Boolean(cfg.openAiApiKey),
    openai_key_source: dbKey ? "settings" : process.env.OPENAI_API_KEY ? "env" : "none",
    openai_key_hint: maskSecret(dbKey),
  };
}

const json = async () => NextResponse.json(await view(), { headers: { "Cache-Control": "no-store" } });

// Owner-only (browser session): voice settings for auto-narrated shows.
export async function GET() {
  if (!(await ownerId())) return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  return json();
}

export async function POST(req: Request) {
  if (!(await ownerId())) return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "That request didn't come through right. Try again." }, { status: 400 });
  const updates: Record<string, string | null> = {};

  if (body.provider !== undefined) {
    if (!TTS_PROVIDERS.includes(body.provider)) {
      return NextResponse.json({ error: `Pick a voice service: ${TTS_PROVIDERS.join(", ")}.` }, { status: 400 });
    }
    updates[SETTING_KEYS.ttsProvider] = body.provider;
  }
  if (body.openai_voice !== undefined) {
    if (!(OPENAI_VOICES as readonly string[]).includes(body.openai_voice)) {
      return NextResponse.json({ error: "We don't know that voice. Pick one from the list." }, { status: 400 });
    }
    updates[SETTING_KEYS.openAiTtsVoice] = body.openai_voice === DEFAULT_OPENAI_VOICE ? null : body.openai_voice;
  }
  if (body.clear_openai_api_key === true) {
    updates[SETTING_KEYS.openAiTtsApiKey] = null;
  } else if (typeof body.openai_api_key === "string" && body.openai_api_key.trim() !== "") {
    const key = body.openai_api_key.trim();
    if (key.length > 300 || /\s/.test(key)) return NextResponse.json({ error: "That doesn't look like a voice key. Copy the whole key from OpenAI and paste it again." }, { status: 400 });
    updates[SETTING_KEYS.openAiTtsApiKey] = key;
  }

  if (Object.keys(updates).length) await setSettings(updates);
  return json();
}
