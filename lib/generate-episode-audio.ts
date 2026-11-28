import { sql } from "@/lib/db";
import { joinMp3 } from "@/lib/mp3";
import { synthesize, chunkText, speakerRuns, type TtsHost } from "@/lib/tts";
import { getStorage } from "@/lib/storage";

export async function generateEpisodeAudio(episodeId: string, runId: string): Promise<{ complete: boolean }> {
  try {
    const rows = (await sql`
      select e.script, s.voice_id, s.hosts
      from episodes e join shows s on s.id = e.show_id
      join runs r on r.show_id = e.show_id and r.episode_id = e.id
      where e.id = ${episodeId} and r.id = ${runId} and r.status = 'running'
    `) as { script: string; voice_id: string | null; hosts: TtsHost[] | null }[];
    const episode = rows[0];
    if (!episode) throw new Error("The draft or generation run could not be found.");

    // Multi-host shows read each speaker's lines in that host's own voice, so
    // the per-POST unit must be a speaker run (not a raw text slice) or both
    // hosts collapse into the show's single voice. Single-host shows keep the
    // simple character chunking. synthesize() still sub-chunks each unit for
    // the provider's own length limit.
    const hosts = episode.hosts ?? [];
    const units: { text: string; voice: string | null }[] =
      hosts.length > 1
        ? speakerRuns(episode.script, hosts)
        : chunkText(episode.script, 2500).map((text) => ({ text, voice: null }));
    const chunks = units;
    const existing = (await sql`
      select chunk_index, data, content_type, provider from episode_audio_chunks
      where run_id = ${runId} and episode_id = ${episodeId} order by chunk_index
    `) as { chunk_index: number; data: Buffer; content_type: string; provider: string }[];
    const savedIndices = new Set(existing.map((chunk) => chunk.chunk_index));
    const chunkIndex = chunks.findIndex((_, index) => !savedIndices.has(index));

    if (chunkIndex !== -1) {
      const unit = chunks[chunkIndex];
      const tts = await synthesize(unit.text, unit.voice || episode.voice_id);
      await sql`
        insert into episode_audio_chunks (run_id, episode_id, chunk_index, content_type, provider, data)
        values (${runId}, ${episodeId}, ${chunkIndex}, ${tts.contentType}, ${tts.provider}, ${tts.audio})
        on conflict (run_id, chunk_index) do nothing
      `;
      await sql`update runs set heartbeat_at = now() where id = ${runId} and status = 'running'`;
      if (savedIndices.size + 1 < chunks.length) return { complete: false };
    }

    const allChunks = (await sql`
      select data, content_type, provider from episode_audio_chunks
      where run_id = ${runId} and episode_id = ${episodeId} order by chunk_index
    `) as { data: Buffer; content_type: string; provider: string }[];
    if (allChunks.length !== chunks.length) return { complete: false };

    const audio = joinMp3(allChunks.map((chunk) => chunk.data));
    const contentType = allChunks[0].content_type || "audio/mpeg";
    const storage = getStorage();
    await storage.put(episodeId, audio, contentType);
    const saved = (await sql`
      with completed as (
        update runs set status = 'done', tts_provider = ${allChunks.at(-1)!.provider},
          error = null, heartbeat_at = now(), finished_at = now()
        where id = ${runId} and status = 'running'
        returning id
      )
      update episodes set audio_url = ${storage.url(episodeId)}, byte_size = ${audio.length},
        audio_content_type = ${contentType}, status = 'published', published_at = now()
      where id = ${episodeId} and exists (select 1 from completed)
      returning id
    `) as { id: string }[];
    if (!saved[0]) throw new Error("The generation run ended before its audio could be saved.");
    await sql`delete from episode_audio_chunks where run_id = ${runId}`;
    return { complete: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await sql`
      update runs set status = 'failed', error = ${reason}, finished_at = now()
      where id = ${runId} and status = 'running'
    `;
    throw err;
  }
}
