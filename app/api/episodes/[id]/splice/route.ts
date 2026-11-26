import { NextResponse } from "next/server";
import {
  DEFAULT_CROSSFADE_SECONDS,
  estimateSentenceStart,
  probeMp3Duration,
  rebuildScript,
  splitIntoSentences,
  spliceAudio,
  tailScript,
} from "@/lib/audio-splice";
import { sql } from "@/lib/db";
import { sanitizeError } from "@/lib/errors";
import { friendlyVoiceError } from "@/lib/generate";
import { applyPronunciations } from "@/lib/pronounce";
import { getStorage } from "@/lib/storage";
import { estimateDurationSeconds, synthesize } from "@/lib/tts";
import type { Pronunciation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };
const MAX_SENTENCE_CHARS = 4000;

// Browser forms get a redirect back to the editor; fetch clients get JSON.
// Both only ever report safe, owner-facing messages.
function reply(req: Request, isForm: boolean, status: number, data: Record<string, unknown>, query?: Record<string, string>) {
  if (isForm) {
    const url = new URL(`/episodes/${encodeURIComponent(String(data.episodeId ?? ""))}/edit`, req.url);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    return NextResponse.redirect(url, 303);
  }
  return NextResponse.json(data, { status });
}

function fail(req: Request, isForm: boolean, status: number, message: string, id: string) {
  return reply(req, isForm, status, { error: message, episodeId: id }, { error: message });
}

async function readBody(req: Request): Promise<{ values: Record<string, unknown>; isForm: boolean }> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await req.formData();
    return { values: Object.fromEntries(form.entries()), isForm: true };
  }
  const body = await req.json().catch(() => ({}));
  return { values: body && typeof body === "object" ? (body as Record<string, unknown>) : {}, isForm: false };
}

// Re-read one sentence (and the sentences after it) in the show's voice, then
// keep the original audio before that sentence and crossfade the new tail in.
// Owner-only like every other non-GET API route (middleware.ts). No schema
// change: the corrected text goes back into episodes.script.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let values: Record<string, unknown>;
  let isForm: boolean;
  try {
    ({ values, isForm } = await readBody(req));
  } catch {
    return fail(req, true, 400, "Couldn't read that edit. Try again.", id);
  }

  const index = Number(values.sentenceIndex);
  const text = typeof values.text === "string" ? values.text.replace(/\s+/g, " ").trim() : "";
  if (!Number.isInteger(index) || index < 0) {
    return fail(req, isForm, 400, "Pick a sentence to fix.", id);
  }
  if (!text || text.length > MAX_SENTENCE_CHARS) {
    return fail(req, isForm, 400, `The replacement must be between 1 and ${MAX_SENTENCE_CHARS} characters.`, id);
  }

  let episode: {
    id: string;
    show_id: string;
    script: string | null;
    audio_url: string | null;
    voice_id: string | null;
  } | undefined;
  let pronunciations: Pronunciation[] = [];
  try {
    const rows = (await sql`
      select e.id, e.show_id, e.script, e.audio_url, s.voice_id
      from episodes e join shows s on s.id = e.show_id
      where e.id = ${id}
    `) as typeof episode[];
    episode = rows[0];
    if (episode) {
      pronunciations = (await sql`
        select * from show_pronunciations where show_id = ${episode.show_id} order by created_at asc
      `) as Pronunciation[];
    }
  } catch (err) {
    console.error(`[splice] ${id} lookup: ${err instanceof Error ? err.message : String(err)}`);
    return fail(req, isForm, 500, sanitizeError(err, "episode splice lookup"), id);
  }
  if (!episode) return fail(req, isForm, 404, "Episode not found.", id);
  if (!episode.audio_url) return fail(req, isForm, 409, "Make the episode's audio before fixing a sentence.", id);
  if (!episode.script?.trim()) return fail(req, isForm, 400, "This episode has no transcript to edit.", id);

  const sentences = splitIntoSentences(episode.script);
  const chosen = sentences[index];
  if (!chosen) return fail(req, isForm, 400, "That sentence is no longer in the transcript. Reload and try again.", id);
  if (chosen.text === text) return fail(req, isForm, 400, "That sentence is unchanged. Edit the text first.", id);

  const storage = getStorage();
  let original: Awaited<ReturnType<typeof storage.get>>;
  try {
    original = await storage.get(id);
  } catch (err) {
    console.error(`[splice] ${id} storage read: ${err instanceof Error ? err.message : String(err)}`);
    return fail(req, isForm, 500, sanitizeError(err, "episode splice read"), id);
  }
  if (!original) return fail(req, isForm, 409, "This episode's audio is missing.", id);

  const updatedScript = rebuildScript(episode.script, sentences, index, text);
  const retold = tailScript(sentences, index, text);
  // STUB: no provider timestamps. Share the file's real length across the
  // sentences by word count, so this is close but not sample-accurate.
  const totalSeconds = (await probeMp3Duration(original.bytes)) ?? estimateDurationSeconds(episode.script);
  const boundarySeconds = estimateSentenceStart(sentences, index, totalSeconds);

  let replacement: Awaited<ReturnType<typeof synthesize>>;
  try {
    replacement = await synthesize(applyPronunciations(retold, pronunciations), episode.voice_id);
  } catch (err) {
    console.error(`[splice] ${id} voice: ${err instanceof Error ? err.message : String(err)}`);
    return fail(req, isForm, 502, friendlyVoiceError(err), id);
  }

  let audio: Buffer;
  try {
    audio = await spliceAudio({
      original: original.bytes,
      replacement: replacement.audio,
      boundarySeconds,
      crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    });
  } catch (err) {
    console.error(`[splice] ${id} ffmpeg: ${err instanceof Error ? err.message : String(err)}`);
    return fail(req, isForm, 502, "The audio couldn't be spliced. Nothing was changed. Check that ffmpeg is installed.", id);
  }

  const durationSeconds = (await probeMp3Duration(audio)) ?? estimateDurationSeconds(updatedScript);
  let episodeRow: unknown;
  try {
    await storage.put(id, audio, "audio/mpeg");
    const rows = (await sql`
      update episodes set
        script = ${updatedScript},
        audio_url = ${storage.url(id)},
        byte_size = ${audio.length},
        audio_content_type = 'audio/mpeg',
        duration_seconds = ${durationSeconds}
      where id = ${id}
      returning *
    `) as unknown[];
    episodeRow = rows[0] ?? null;
  } catch (err) {
    console.error(`[splice] ${id} save: ${err instanceof Error ? err.message : String(err)}`);
    return fail(req, isForm, 500, sanitizeError(err, "episode splice save"), id);
  }

  return reply(
    req,
    isForm,
    200,
    {
      episode: episodeRow,
      episodeId: id,
      sentenceIndex: index,
      boundarySeconds,
      crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
      stubbed: true,
      timingSource: "word-count",
      note: "Sentence timing is estimated by word count; the join may be off by a fraction of a second.",
    },
    { saved: "1", fixed: String(index), stubbed: "1" },
  );
}
