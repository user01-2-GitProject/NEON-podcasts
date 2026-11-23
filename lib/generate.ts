import { randomUUID } from "node:crypto";
import { getSql, sql } from "@/lib/db";
import { generateScript, estimateCostCents } from "@/lib/claude";
import { synthesize, estimateDurationSeconds } from "@/lib/tts";
import { getStorage } from "@/lib/storage";
import type { Show, Briefing, Episode, NarrationMode } from "@/lib/types";

export const MAX_SCHEDULED_ATTEMPTS = 5;

export interface ScheduledRunContext {
  id: string;
  scheduledFor: string;
}

// One run = one episode for a show. Reads active briefings and writes a script
// via Claude, then either:
//   - "auto":     renders audio via TTS, stores the mp3 → a published episode.
//   - "external": skips TTS and saves a script-only draft. The user narrates it
//                 externally (e.g. in Muse) and uploads the finished mp3 into the
//                 episode via POST /api/episodes/[id]/audio (Pattern A).
export async function generateEpisode(
  showId: string,
  modeOverride?: NarrationMode,
  scheduledRun?: ScheduledRunContext,
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

  let runId = scheduledRun?.id;
  if (!runId) {
    const runRows = (await sql`
      insert into runs (show_id, status, briefing_snapshot)
      values (${showId}, 'running', ${briefingSnapshot})
      returning id
    `) as { id: string }[];
    runId = runRows[0].id;
  }

  let pendingAudioEpisodeId: string | undefined;
  try {
    if (scheduledRun) {
      await sql`
        update runs set briefing_snapshot = ${briefingSnapshot}
        where id = ${runId} and show_id = ${showId}
      `;
    }

    const { result, model, inputTokens, outputTokens } = await generateScript({
      showTitle: show.title,
      showDescription: show.description,
      targetMinutes: show.target_minutes,
      briefings: briefings.map((b) => ({ filename: b.filename, content_md: b.content_md })),
    });

    const duration = estimateDurationSeconds(result.script);
    const costCents = estimateCostCents(inputTokens, outputTokens);

    if (mode === "external") {
      if (scheduledRun) {
        const episodeId = randomUUID();
        const results = await getSql().transaction((tx) => [
          tx`
            insert into episodes
              (id, show_id, title, script, show_notes, duration_seconds, status, scheduled_for)
            values
              (${episodeId}, ${showId}, ${result.title}, ${result.script}, ${result.show_notes},
               ${duration}, 'draft', ${scheduledRun.scheduledFor})
            returning *
          `,
          tx`
            update runs set
              status = 'done', episode_id = ${episodeId}, model = ${model},
              tts_provider = 'external', cost_cents = ${costCents}, error = null,
              next_attempt_at = null, finished_at = now()
            where id = ${runId}
          `,
          tx`
            update shows set next_run_at = case cadence
              when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
              when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
              else null
            end
            where id = ${showId} and next_run_at = ${scheduledRun.scheduledFor}::timestamptz
          `,
        ]);
        return { episode: (results[0] as Episode[])[0], runId };
      }

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

    if (scheduledRun) {
      const episodeId = randomUUID();
      pendingAudioEpisodeId = episodeId;
      const storage = getStorage();
      const audioPath = storage.url(episodeId);
      await sql`
        insert into episodes
          (id, show_id, title, script, show_notes, duration_seconds, byte_size, audio_content_type, status, scheduled_for)
        values
          (${episodeId}, ${showId}, ${result.title}, ${result.script}, ${result.show_notes},
           ${duration}, ${byteSize}, ${tts.contentType}, 'draft', ${scheduledRun.scheduledFor})
      `;
      await storage.put(episodeId, tts.audio, tts.contentType);
      const results = await getSql().transaction((tx) => [
        tx`
          update episodes set audio_url = ${audioPath}, status = 'published', published_at = now()
          where id = ${episodeId} returning *
        `,
        tx`
          update runs set
            status = 'done', episode_id = ${episodeId}, model = ${model},
            tts_provider = ${tts.provider}, cost_cents = ${costCents}, error = null,
            next_attempt_at = null, finished_at = now()
          where id = ${runId} and status = 'running'
        `,
        tx`
          update shows set next_run_at = case cadence
            when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
            when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
            else null
          end
          where id = ${showId} and next_run_at = ${scheduledRun.scheduledFor}::timestamptz
        `,
      ]);
      return { episode: (results[0] as Episode[])[0], runId };
    }

    const storage = getStorage();
    const episodeRows = (await sql`
      insert into episodes
        (show_id, title, script, show_notes, duration_seconds, byte_size, audio_content_type, status)
      values
        (${showId}, ${result.title}, ${result.script}, ${result.show_notes},
         ${duration}, ${byteSize}, ${tts.contentType}, 'draft')
      returning *
    `) as Episode[];
    const episode = episodeRows[0];
    pendingAudioEpisodeId = episode.id;

    const audioPath = storage.url(episode.id);
    await storage.put(episode.id, tts.audio, tts.contentType);
    await sql`update episodes set audio_url = ${audioPath}, status = 'published', published_at = now() where id = ${episode.id}`;
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
    if (pendingAudioEpisodeId) {
      await sql`delete from episodes where id = ${pendingAudioEpisodeId} and status = 'draft'`;
    }
    if (scheduledRun) {
      await sql`
        with failed as (
          update runs set
            status = 'failed', error = ${message}, finished_at = now(),
            next_attempt_at = case
              when attempt_count < ${MAX_SCHEDULED_ATTEMPTS}
                then now() + (interval '1 minute' * power(2, attempt_count - 1))
              else null
            end
          where id = ${runId} and status = 'running'
          returning attempt_count
        )
        update shows set next_run_at = case cadence
          when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
          when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
          else null
        end
        where id = ${showId}
          and next_run_at = ${scheduledRun.scheduledFor}::timestamptz
          and exists (
            select 1 from failed where attempt_count >= ${MAX_SCHEDULED_ATTEMPTS}
          )
      `;
    } else {
      await sql`
        update runs set status = 'failed', error = ${message}, finished_at = now()
        where id = ${runId}
      `;
    }
    throw err;
  }
}
