// Text-to-speech abstraction. Supports OpenAI and ElevenLabs.
// Long scripts are chunked and the resulting mp3 buffers concatenated.

const MAX_CHARS_PER_CHUNK = 3500;

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: string;
}

export async function synthesize(script: string, voiceOverride?: string | null): Promise<TtsResult> {
  const provider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
  const chunks = chunkText(script, MAX_CHARS_PER_CHUNK);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    if (provider === "elevenlabs") {
      buffers.push(await elevenLabs(chunk, voiceOverride));
    } else {
      buffers.push(await openai(chunk, voiceOverride));
    }
  }

  return { audio: Buffer.concat(buffers), contentType: "audio/mpeg", provider };
}

async function openai(text: string, voiceOverride?: string | null): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = voiceOverride || process.env.OPENAI_TTS_VOICE || "alloy";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  });
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

  const res = await fetch(
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
function chunkText(text: string, limit: number): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/);
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

// We do not decode the mp3 to measure exact duration in the MVP.
// Estimate from word count at ~150 wpm; good enough for the UI + later RSS.
export function estimateDurationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}
