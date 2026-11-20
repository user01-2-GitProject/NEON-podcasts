import { sql } from "@/lib/db";
import { generateScript, estimateCostCents } from "@/lib/claude";
import { synthesize, estimateDurationSeconds } from "@/lib/tts";
import type { Show, Briefing, Episode, NarrationMode } from "@/lib/types";

// One run = one episode for a show. Reads active briefings and writes a script
// via Claude, then either:
//   - "auto":     renders audio via TTS, stores the mp3 → a published episode.
//   - "external": skips TTS and saves a script-only draft. The user narrates it
//                 externally (e.g. in Muse) and uploads the finished mp3 into the
//                 episode via POST /api/episodes/[id]/audio (Pattern A).
export async function generateEpisode(
  showId: string,
  modeOverride?: NarrationMode,
): Promise<{ episode: Episode; runId: string }> {
  const showRows = (await sql`select * from shows where id = ${showId}`) as Show[];
  const show = showRows[0];
  if (!show) throw new Error("Show not found");

  const mode: NarrationMode =
    modeOverride ?? (show.narration_mode === "external" ? "external" : "auto");

  const briefings = (await sql`
    select * from show_briefings
    where show_id = ${showId} and is_active = true
    order by uploaded_at asc
  `) as Briefing[];

  const briefingSnapshot = briefings
    .map((b) => `### ${b.filename}\n${b.content_md}`)
    .join("\n\n");

  const runRows = (await sql`
    insert into runs (show_id, status, briefing_snapshot)
    values (${showId}, 'running', ${briefingSnapshot})
    returning id
  `) as { id: string }[];
  const runId = runRows[0].id;

  try {
    const { result, model, inputTokens, outputTokens } = await generateScript({
      showTitle: show.title,
      showDescription: show.description,
      targetMinutes: show.target_minutes,
      briefings: briefings.map((b) => ({ filename: b.filename, content_md: b.content_md })),
    });

    const duration = estimateDurationSeconds(result.script);
    const costCents = estimateCostCents(inputTokens, outputTokens);

    if (mode === "external") {
      // Script-only: create a draft episode, no TTS. The user uploads the mp3.
      const episodeRows = (await sql`
        insert into episodes
          (show_id, title, script, show_notes, duration_seconds, status)
        values
          (${showId}, ${result.title}, ${result.script}, ${result.show_notes},
           ${duration}, 'draft')
        returning *
      `) as Episode[];
      const episode = episodeRows[0];

      await sql`
        update runs set
          status = 'done',
          episode_id = ${episode.id},
          model = ${model},
          tts_provider = 'external',
          cost_cents = ${costCents},
          finished_at = now()
        where id = ${runId}
      `;

      return { episode, runId };
    }

    // "auto": render audio and publish.
    const tts = await synthesize(result.script, show.voice_id);
    const byteSize = tts.audio.length;

    const episodeRows = (await sql`
      insert into episodes
        (show_id, title, script, show_notes, duration_seconds, byte_size, status, published_at)
      values
        (${showId}, ${result.title}, ${result.script}, ${result.show_notes},
         ${duration}, ${byteSize}, 'published', now())
      returning *
    `) as Episode[];
    const episode = episodeRows[0];

    const audioPath = `/api/episodes/${episode.id}/audio`;
    const audioB64 = tts.audio.toString("base64");
    await sql`
      insert into episode_audio (episode_id, content_type, data)
      values (${episode.id}, ${tts.contentType}, decode(${audioB64}, 'base64'))
    `;
    await sql`update episodes set audio_url = ${audioPath} where id = ${episode.id}`;
    episode.audio_url = audioPath;

    await sql`
      update runs set
        status = 'done',
        episode_id = ${episode.id},
        model = ${model},
        tts_provider = ${tts.provider},
        cost_cents = ${costCents},
        finished_at = now()
      where id = ${runId}
    `;

    return { episode, runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      update runs set status = 'failed', error = ${message}, finished_at = now()
      where id = ${runId}
    `;
    throw err;
  }
}
