import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateEpisode, MAX_SCHEDULED_ATTEMPTS } from "@/lib/generate";

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
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      else null
    end
    from stale
    where shows.id = stale.show_id
      and shows.next_run_at = stale.scheduled_for
      and stale.attempt_count >= ${MAX_SCHEDULED_ATTEMPTS}
  `;

  // Existing shows predate scheduling. Give valid daily/weekly shows their first future slot.
  await sql`
    update shows set next_run_at = case
      when (((now() at time zone timezone)::date + schedule_time::time) at time zone timezone) > now()
        then (((now() at time zone timezone)::date + schedule_time::time) at time zone timezone)
      else ((((now() at time zone timezone)::date + 1) + schedule_time::time) at time zone timezone)
    end
    where next_run_at is null
      and is_active = true
      and cadence in ('daily', 'weekly')
      and schedule_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and timezone in (select name from pg_timezone_names)
  `;

  // The partial unique index makes this an atomic one-run claim per show and slot.
  await sql`
    insert into runs (show_id, status, scheduled_for, next_attempt_at)
    select id, 'queued', next_run_at, now()
    from shows
    where is_active = true
      and cadence in ('daily', 'weekly')
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
        and shows.cadence in ('daily', 'weekly')
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

  const settled = await Promise.allSettled(
    claimed.map((run) =>
      generateEpisode(run.show_id, undefined, {
        id: run.id,
        scheduledFor: run.scheduled_for,
      }),
    ),
  );

  return NextResponse.json({
    dispatched: claimed.length,
    done: settled.filter((result) => result.status === "fulfilled").length,
    failed: settled.filter((result) => result.status === "rejected").length,
  });
}
