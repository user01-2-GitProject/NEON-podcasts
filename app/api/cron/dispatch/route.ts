import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateEpisode, MAX_SCHEDULED_ATTEMPTS } from "@/lib/generate";
import { decideScheduledBatch, skipScheduledRun } from "@/lib/limits";
import { SCHEDULED_CADENCES, firstSlot } from "@/lib/cadence";

export const runtime = "nodejs";
export const maxDuration = 300;

const DISPATCH_LIMIT = 10;

interface ScheduledRun {
  id: string;
  show_id: string;
  scheduled_for: string;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Vercel can terminate work at maxDuration. Release abandoned claims after a safe buffer.
  await sql`
    with stale as (
      update runs set
        status = 'failed',
        error = 'Generation attempt timed out',
        finished_at = now(),
        next_attempt_at = case
          when attempt_count < ${MAX_SCHEDULED_ATTEMPTS} then now()
          else null
        end
      where status = 'running'
        and scheduled_for is not null
        and started_at < now() - interval '10 minutes'
      returning show_id, scheduled_for, attempt_count
    )
    update shows set next_run_at = case cadence
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      else null
    end
    from stale
    where shows.id = stale.show_id
      and shows.next_run_at = stale.scheduled_for
      and stale.attempt_count >= ${MAX_SCHEDULED_ATTEMPTS}
  `;

  // Shows without a slot yet (older shows, or ones just switched on) get their first future slot.
  const unscheduled = (await sql`
    select id, cadence, schedule_time, timezone from shows
    where next_run_at is null and is_active = true and cadence = any(${SCHEDULED_CADENCES})
  `) as { id: string; cadence: string; schedule_time: string; timezone: string }[];
  for (const show of unscheduled) {
    const slot = firstSlot(show.cadence, show.schedule_time, show.timezone);
    if (!slot) continue;
    await sql`update shows set next_run_at = ${slot.toISOString()} where id = ${show.id} and next_run_at is null`;
  }

  // The partial unique index makes this an atomic one-run claim per show and slot.
  await sql`
    insert into runs (show_id, status, scheduled_for, next_attempt_at)
    select id, 'queued', next_run_at, now()
    from shows
    where is_active = true
      and cadence = any(${SCHEDULED_CADENCES})
      and next_run_at <= now()
    on conflict (show_id, scheduled_for) where scheduled_for is not null do nothing
  `;

  const claimed = (await sql`
    with candidates as (
      select runs.id
      from runs
      join shows on shows.id = runs.show_id
      where runs.status in ('queued', 'failed')
        and runs.scheduled_for is not null
        and runs.attempt_count < ${MAX_SCHEDULED_ATTEMPTS}
        and coalesce(runs.next_attempt_at, now()) <= now()
        and shows.is_active = true
        and shows.cadence = any(${SCHEDULED_CADENCES})
        and shows.next_run_at = runs.scheduled_for
      order by runs.scheduled_for
      limit ${DISPATCH_LIMIT}
      for update skip locked
    )
    update runs set
      status = 'running',
      attempt_count = attempt_count + 1,
      error = null,
      next_attempt_at = null,
      started_at = now(),
      finished_at = null
    from candidates
    where runs.id = candidates.id
    returning runs.id, runs.show_id, runs.scheduled_for
  `) as ScheduledRun[];

  // Cost guardrail: runs whose show owner is over the daily cap are recorded as
  // skipped (with the reason) and the show moves to its next slot.
  const plan = await decideScheduledBatch(sql, claimed);
  for (const skip of plan.skipped) {
    await skipScheduledRun(sql, skip.runId, skip.reason);
  }
  const allowed = new Set(plan.allowed);

  const settled = await Promise.allSettled(
    claimed
      .filter((run) => allowed.has(run.id))
      .map((run) =>
        generateEpisode(run.show_id, undefined, {
          id: run.id,
          scheduledFor: run.scheduled_for,
        }),
      ),
  );

  return NextResponse.json({
    dispatched: claimed.length,
    skipped: plan.skipped.length,
    done: settled.filter((result) => result.status === "fulfilled").length,
    failed: settled.filter((result) => result.status === "rejected").length,
  });
}
