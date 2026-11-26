import { NextResponse } from "next/server";
import { resolveTtsConfig } from "@/lib/settings";
import { HOST_PRESETS, VOICE_CATALOG } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every voice a show can use, plus the one-tap hosts, for pickers (the setup
// wizard's host step and voice preview). Free voices come first. `available`
// says which sources can actually speak right now: OpenAI needs a key, Kokoro
// needs a reachable local voice server, Edge needs nothing. Kokoro voices are
// left out when no local server is set, so nobody picks a voice that can't talk.
export async function GET() {
  const cfg = await resolveTtsConfig();
  const available = {
    edge: true,
    openai: Boolean(cfg.openAiApiKey),
    kokoro: Boolean(process.env.LOCAL_TTS_URL),
  };
  const voices = VOICE_CATALOG.filter((v) => available.kokoro || v.source !== "kokoro");
  return NextResponse.json(
    { voices, hosts: HOST_PRESETS, available, default_provider: cfg.provider },
    { headers: { "Cache-Control": "no-store" } },
  );
}
