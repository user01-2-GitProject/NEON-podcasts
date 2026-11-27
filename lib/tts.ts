// Text-to-speech abstraction. Supports OpenAI, ElevenLabs, local/self-hosted,
// and free Microsoft Edge voices. Long scripts are chunked and the resulting
// mp3 buffers concatenated.
//
// The show's voice id picks the engine first ("edge:..." is always Edge,
// "kokoro:..." is always the local server), so a free voice stays free even
// when the app-wide setting is OpenAI. Anything else uses the app-wide
// provider from Settings → Voice.

import { joinMp3 } from "@/lib/mp3";
import { pickOpenAiVoice, resolveTtsConfig, type TtsConfig, type TtsProvider } from "@/lib/settings";
import { DEFAULT_EDGE_VOICE, voiceName, voiceSource } from "@/lib/voices";
import { fetchWithTimeout } from "@/lib/request-timeout";

const MAX_CHARS_PER_CHUNK = 3500;

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: string;
}

export interface TtsHost { name: string; voice: string }

export function speakerRuns(script: string, hosts: TtsHost[]): { text: string; voice: string | null }[] {
  const byName = new Map(hosts.map((h) => [h.name.trim().toLowerCase(), h.voice]));
  const runs: { text: string; voice: string | null }[] = [];
  let current: { text: string; voice: string | null } | null = null;
  for (const line of script.replace(/\r\n/g, "\n").split("\n")) {
    const match = /^([^:\n]+):\s*(.*)$/.exec(line);
    if (match) {
      current = { text: match[2], voice: byName.get(match[1].trim().toLowerCase()) ?? null };
      runs.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    }
  }
  return runs.filter((r) => r.text.trim());
}

export async function synthesize(script: string, voiceOverride?: string | null, hosts?: TtsHost[] | null): Promise<TtsResult> {
  if (hosts && hosts.length > 1) {
    const runs = speakerRuns(script, hosts);
    if (runs.length) {
      const rendered = await Promise.all(runs.map((run) => synthesizeText(run.text, run.voice || voiceOverride || null)));
      return { audio: joinMp3(rendered.map((r) => r.audio)), contentType: "audio/mpeg", provider: rendered[0].provider };
    }
  }
  return synthesizeText(script, voiceOverride);
}

async function synthesizeText(script: string, voiceOverride?: string | null): Promise<TtsResult> {
  const config = await resolveTtsConfig();
  const provider = providerFor(voiceOverride, config.provider);
  const voice = voiceOverride ? voiceName(voiceOverride) : voiceOverride;
  const chunks = chunkText(script, provider === "edge" ? EDGE_MAX_CHARS : MAX_CHARS_PER_CHUNK);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    if (provider === "edge") {
      buffers.push(await edgeTts(chunk, voiceSource(voiceOverride) === "edge" ? voice : null));
    } else if (provider === "elevenlabs") {
      buffers.push(await elevenLabs(chunk, voice));
    } else if (provider === "local") {
      buffers.push(await localOpenAICompatible(chunk, voice));
    } else {
      buffers.push(await openai(chunk, voice, config));
    }
  }

  // Joined without each piece's length header, so players don't stop or skip
  // where the first piece ends.
  return { audio: joinMp3(buffers), contentType: "audio/mpeg", provider };
}

/** Which engine reads this show: the voice id's own source wins over the app setting. */
export function providerFor(voiceId: string | null | undefined, appProvider: TtsProvider): TtsProvider {
  const source = voiceSource(voiceId);
  if (source === "edge") return "edge";
  if (source === "kokoro") return "local";
  return appProvider;
}

// Free Microsoft Edge "Read aloud" voices: no key, no account. This is the
// same service the Edge browser uses, reached through the msedge-tts package.
// It's unofficial, so if Microsoft changes it the error below says so plainly
// and the script is kept (lib/generate.ts).
const EDGE_MAX_CHARS = 2500;

async function edgeTts(text: string, voice: string | null | undefined): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice || DEFAULT_EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text));
    const parts: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out after 90 seconds")), 90_000);
      audioStream.on("data", (c: Buffer) => parts.push(Buffer.from(c)));
      audioStream.on("end", () => { clearTimeout(timer); resolve(); });
      audioStream.on("close", () => { clearTimeout(timer); resolve(); });
      audioStream.on("error", (e: Error) => { clearTimeout(timer); reject(e); });
    });
    const audio = Buffer.concat(parts);
    if (!audio.length) throw new Error("no audio came back");
    return audio;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`Free voice failed (Microsoft Edge): ${why}`);
  } finally {
    try { tts.close(); } catch {}
  }
}

// The Edge service reads SSML, so <, > and & in a script must be escaped.
function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Local / self-hosted voices via any OpenAI-compatible speech endpoint.
// Works with Kokoro-FastAPI, openedai-speech (Piper/Coqui/XTTS), LocalAI, etc.
// Set LOCAL_TTS_URL to the full endpoint, e.g. http://localhost:8000/v1/audio/speech.
// NOTE: when the app runs on Vercel it cannot reach your machine's localhost — run
// the app locally, or give the local engine a reachable URL (tunnel / self-host).
async function localOpenAICompatible(text: string, voiceOverride?: string | null): Promise<Buffer> {
  const url = process.env.LOCAL_TTS_URL;
  if (!url) throw new Error("LOCAL_TTS_URL is not set (point it at your local OpenAI-compatible TTS endpoint)");
  const model = process.env.LOCAL_TTS_MODEL || "tts-1";
  const voice = voiceOverride || process.env.LOCAL_TTS_VOICE || "alloy";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.LOCAL_TTS_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  }, "Local TTS request");
  if (!res.ok) {
    throw new Error(`Local TTS failed (${res.status}): ${await safeText(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function openai(text: string, voiceOverride: string | null | undefined, config: TtsConfig): Promise<Buffer> {
  const apiKey = config.openAiApiKey;
  if (!apiKey) {
    throw new Error("No OpenAI voice key: paste one under Settings → Voice, or use Script only narration");
  }
  const model = config.openAiModel;
  const voice = pickOpenAiVoice(voiceOverride, config.openAiVoice);

  const res = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  }, "OpenAI TTS request");
  if (!res.ok) {
    throw new Error(`OpenAI TTS failed (${res.status}): ${await safeText(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function elevenLabs(text: string, voiceOverride?: string | null): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const voiceId = voiceOverride || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  const res = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: modelId }),
    },
    "ElevenLabs TTS request",
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${await safeText(res)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

// Split on paragraph/sentence boundaries, never mid-word, staying under the limit.
export function chunkText(text: string, limit: number): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return [clean];

  // A run-on "sentence" longer than the limit is split on words, so no piece
  // goes over the voice service's input cap.
  const sentences = clean.split(/(?<=[.!?])\s+/).flatMap((s) => splitLong(s, limit));
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > limit && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function splitLong(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence];
  const out: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/)) {
    if (current && current.length + 1 + word.length > limit) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

// We do not decode the mp3 to measure exact duration in the MVP.
// Estimate from word count at ~150 wpm; good enough for the UI + later RSS.
export function estimateDurationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}
