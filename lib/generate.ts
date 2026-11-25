import { randomUUID } from "node:crypto";
import { getSql, sql } from "@/lib/db";
import { generateScript, estimateCostCents } from "@/lib/claude";
import { synthesize, estimateDurationSeconds } from "@/lib/tts";
import { applyPronunciations } from "@/lib/pronounce";
import { checkScript, needsRewrite, rewriteNotes } from "@/lib/script-check";
import { getStorage } from "@/lib/storage";
import { selectBriefings, todayIn } from "@/lib/episode-spec";
import { researchBrief, lookUp, researchBriefing, sourcesNote, SEARCH_COST_CENTS } from "@/lib/research";
import type { Show, Briefing, Episode, NarrationMode, Pronunciation } from "@/lib/types";

export const MAX_SCHEDULED_ATTEMPTS = 5;

// A voice failure explained in words a show owner can act on. Provider
// details stay in the server log and the runs table.
export function friendlyVoiceError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/^No OpenAI voice key/.test(message)) {
    return "The script is saved, but there's no voice key yet. Add one under Settings → Voice, then press Make audio on the episode.";
  }
  return "The script is saved, but the voice step failed. Check Settings → Voice, then press Make audio on the episode to try again.";
}

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
): Promise<{ episode: Episode; runId: string; voiceError?: string }> {
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

  const pronunciations = (await sql`
    select * from show_pronunciations where show_id = ${showId} order by created_at asc
  `) as Pronunciation[];

  // At most one ready, due episode plan is used per run; other plans wait.
  const selection = selectBriefings(briefings, todayIn(show.timezone));
  const planBriefingId = selection.plan?.briefingId;

  const briefingSnapshot = selection.docs
    .map((b) => `### ${b.filename}\n${b.content_md}`)
    .join("\n\n");

  // A used plan is switched off so the next run doesn't repeat it.
  const finish = async <T,>(result: T): Promise<T> => {
    if (planBriefingId) {
      await sql`update show_briefings set is_active = false where id = ${planBriefingId}`;
    }
    return result;
  };

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

    // Shows that ask for it get one web look-up first; what it found becomes
    // one more briefing (and the episode's sources).
    const brief = researchBrief(show.style_guide);
    let docs = selection.docs;
    let research: Awaited<ReturnType<typeof lookUp>> | null = null;
    if (brief) {
      const today = todayIn(show.timezone);
      research = await lookUp({
        showTitle: show.title,
        showDescription: show.description,
        brief,
        today,
        timezone: show.timezone,
        episodeTitle: selection.plan?.title || undefined,
      });
      const looked = researchBriefing(research, today);
      docs = [...selection.docs, looked];
      await sql`
        update runs set briefing_snapshot = ${`${briefingSnapshot}\n\n### ${looked.filename}\n${looked.content_md}`}
        where id = ${runId} and show_id = ${showId}
      `;
    }

    const scriptArgs = {
      showTitle: show.title,
      showDescription: show.description,
      targetMinutes: show.target_minutes,
      briefings: docs,
      styleGuide: show.style_guide,
      episodeTitle: selection.plan?.title || undefined,
    };
    let { result, model, inputTokens, outputTokens } = await generateScript(scriptArgs);

    // Check the script before it becomes audio. A draft with a real problem
    // (repeats, leftover blanks or markup, cut off) gets one rewrite; what's
    // still wrong after that is noted on the run for the owner to see.
    let issues = checkScript(result.script, show.target_minutes);
    if (needsRewrite(issues)) {
      console.warn(`[script-check] rewriting: ${issues.map((i) => i.kind).join(", ")}`);
      const second = await generateScript({ ...scriptArgs, fixNotes: rewriteNotes(issues) });
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      const secondIssues = checkScript(second.result.script, show.target_minutes);
      if (secondIssues.length <= issues.length) {
        result = second.result;
        model = second.model;
        issues = secondIssues;
      }
    }
    const checkNote = issues.length ? `Script check: ${issues.map((i) => i.message).join(" ")}` : null;

    // A planned episode keeps the title it was planned with.
    if (selection.plan?.title) result.title = selection.plan.title;
    if (research) {
      inputTokens += research.inputTokens;
      outputTokens += research.outputTokens;
      result.show_notes = `${result.show_notes}${sourcesNote(research.sources)}`;
    }

    const duration = estimateDurationSeconds(result.script);
    const costCents = estimateCostCents(inputTokens, outputTokens) + (research ? SEARCH_COST_CENTS : 0);

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
              tts_provider = 'external', cost_cents = ${costCents}, error = ${checkNote},
              next_attempt_at = null, finished_at = now()
            where id = ${runId}
          `,
          tx`
            update shows set next_run_at = case cadence
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      else null
    end
            where id = ${showId} and next_run_at = ${scheduledRun.scheduledFor}::timestamptz
          `,
        ]);
        return finish({ episode: (results[0] as Episode[])[0], runId });
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
          error = ${checkNote},
          finished_at = now()
        where id = ${runId}
      `;

      return finish({ episode, runId });
    }

    // "auto": render audio and publish. Pronunciations affect only the text
    // handed to TTS; the episode row below still stores the original script.
    let tts: Awaited<ReturnType<typeof synthesize>>;
    try {
      tts = await synthesize(applyPronunciations(result.script, pronunciations), show.voice_id);
    } catch (voiceErr) {
      // Scheduled runs retry the whole run. A run someone pressed keeps the
      // script as a draft, so a voice problem never throws away the writing.
      if (scheduledRun) throw voiceErr;
      const draftRows = (await sql`
        insert into episodes (show_id, title, script, show_notes, duration_seconds, status)
        values (${showId}, ${result.title}, ${result.script}, ${result.show_notes}, ${duration}, 'draft')
        returning *
      `) as Episode[];
      const raw = voiceErr instanceof Error ? voiceErr.message : String(voiceErr);
      console.error(`[voice] ${raw}`);
      await sql`
        update runs set
          status = 'failed', episode_id = ${draftRows[0].id}, model = ${model},
          cost_cents = ${costCents}, error = ${`voice: ${raw}`}, finished_at = now()
        where id = ${runId}
      `;
      return finish({ episode: draftRows[0], runId, voiceError: friendlyVoiceError(voiceErr) });
    }
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
            tts_provider = ${tts.provider}, cost_cents = ${costCents}, error = ${checkNote},
            next_attempt_at = null, finished_at = now()
          where id = ${runId} and status = 'running'
        `,
        tx`
          update shows set next_run_at = case cadence
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      else null
    end
          where id = ${showId} and next_run_at = ${scheduledRun.scheduledFor}::timestamptz
        `,
      ]);
      return finish({ episode: (results[0] as Episode[])[0], runId });
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
        error = ${checkNote},
        finished_at = now()
      where id = ${runId}
    `;

    return finish({ episode, runId });
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
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
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
