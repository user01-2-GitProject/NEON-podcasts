import { sql } from "@/lib/db";
import { synthesize } from "@/lib/tts";
import { getStorage } from "@/lib/storage";

export async function generateEpisodeAudio(episodeId: string, runId: string): Promise<void> {
  const rows = (await sql`
    select e.script, s.voice_id
    from episodes e join shows s on s.id = e.show_id
    join runs r on r.show_id = e.show_id and r.episode_id = e.id
    where e.id = ${episodeId} and r.id = ${runId} and r.status = 'running'
  `) as { script: string; voice_id: string | null }[];
  const episode = rows[0];
  if (!episode) throw new Error("The draft or generation run could not be found.");

  const tts = await synthesize(episode.script, episode.voice_id, async () => {
    await sql`update runs set heartbeat_at = now() where id = ${runId} and status = 'running'`;
  });
  const storage = getStorage();
  await storage.put(episodeId, tts.audio, tts.contentType);
  const audioPath = storage.url(episodeId);
  let saved: { id: string }[];
  try {
    saved = (await sql`
    with completed as (
      update runs set status = 'done', tts_provider = ${tts.provider}, error = null,
        heartbeat_at = now(), finished_at = now()
      where id = ${runId} and status = 'running'
      returning id
    )
    update episodes set audio_url = ${audioPath}, byte_size = ${tts.audio.length},
      audio_content_type = ${tts.contentType}, status = 'published', published_at = now()
    where id = ${episodeId} and exists (select 1 from completed)
    returning id
    `) as { id: string }[];
  } catch (err) {
    await storage.delete(episodeId);
    throw err;
  }
  if (!saved[0]) {
    await storage.delete(episodeId);
    throw new Error("The generation run ended before its audio could be saved.");
  }
}
