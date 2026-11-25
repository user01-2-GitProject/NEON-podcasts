import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { friendlyVoiceError } from "@/lib/generate";
import { applyPronunciations } from "@/lib/pronounce";
import { getStorage } from "@/lib/storage";
import { synthesize } from "@/lib/tts";
import type { Pronunciation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// "Make audio": voice an episode that has a script but no audio yet (for
// example when the voice step failed during generation). Owner-only, like
// every non-GET /api route (middleware). Publishes, as auto narration does.
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = (await sql`
    select e.id, e.show_id, e.script, e.audio_url, s.voice_id
    from episodes e join shows s on s.id = e.show_id
    where e.id = ${id}
  `) as { id: string; show_id: string; script: string | null; audio_url: string | null; voice_id: string | null }[];
  const ep = rows[0];
  if (!ep) return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  if (ep.audio_url) return NextResponse.json({ error: "This episode already has audio" }, { status: 409 });
  if (!ep.script?.trim()) return NextResponse.json({ error: "This episode has no script to read" }, { status: 400 });

  const pronunciations = (await sql`
    select * from show_pronunciations where show_id = ${ep.show_id} order by created_at asc
  `) as Pronunciation[];

  let tts: Awaited<ReturnType<typeof synthesize>>;
  try {
    tts = await synthesize(applyPronunciations(ep.script, pronunciations), ep.voice_id);
  } catch (err) {
    console.error(`[voice] narrate ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: friendlyVoiceError(err) }, { status: 502 });
  }

  const storage = getStorage();
  await storage.put(id, tts.audio, tts.contentType);
  const updated = (await sql`
    update episodes set
      audio_url = ${storage.url(id)}, byte_size = ${tts.audio.length},
      audio_content_type = ${tts.contentType}, status = 'published', published_at = now()
    where id = ${id} and audio_url is null
    returning *
  `) as unknown[];
  return NextResponse.json({ episode: updated[0] ?? null }, { status: 200 });
}
