import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { firstSlot, isCadence } from "@/lib/cadence";
import { scheduleError } from "@/lib/schedule";
import { parseImageUrl } from "@/lib/show-image";
import { getStorage } from "@/lib/storage";
import type { Show } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = (await sql`select * from shows where id = ${id}`) as Show[];
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ show: rows[0] });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = (await sql`select * from shows where id = ${id}`) as Show[];
  const show = existing[0];
  if (!show) return NextResponse.json({ error: "not found" }, { status: 404 });

  const title = body.title !== undefined ? body.title.toString().trim() || show.title : show.title;
  const description = body.description !== undefined ? body.description.toString() : show.description;
  const styleGuide = body.style_guide !== undefined ? body.style_guide.toString() : show.style_guide;
  const voiceId = body.voice_id !== undefined ? (body.voice_id ? body.voice_id.toString() : null) : show.voice_id;
  const cadence =
    body.cadence !== undefined && isCadence(body.cadence)
      ? body.cadence
      : show.cadence;
  const scheduleTime = body.schedule_time !== undefined ? body.schedule_time.toString() : show.schedule_time;
  const timezone = body.timezone !== undefined ? body.timezone.toString() : show.timezone;
  const invalidSchedule = cadence === "manual" ? null : scheduleError(scheduleTime, timezone);
  if (invalidSchedule) {
    return NextResponse.json({ error: invalidSchedule }, { status: 400 });
  }
  const targetMinutes =
    body.target_minutes !== undefined && Number.isFinite(Number(body.target_minutes))
      ? Math.max(1, Math.min(120, Math.round(Number(body.target_minutes))))
      : show.target_minutes;
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : show.is_active;
  // is_official: owner-side toggle for the NEON-official badge. Middleware
  // already gates PATCH to owners, so any true/false value is honored.
  if (body.is_official !== undefined) {
    await sql`update shows set is_official = ${Boolean(body.is_official)} where id = ${id}`;
  }
  // Artwork is written only when the request sets it, so other edits keep
  // working before migration 009 adds the column.
  if (body.image_url !== undefined) {
    const image = parseImageUrl(body.image_url);
    if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });
    await sql`update shows set image_url = ${image.value} where id = ${id}`;
  }
  const resetSchedule =
    cadence !== show.cadence ||
    scheduleTime !== show.schedule_time ||
    timezone !== show.timezone ||
    (!show.is_active && isActive);

  const firstRun = firstSlot(cadence, scheduleTime, timezone, new Date(), show.air_days)?.toISOString() ?? null;
  const rows = (await sql`
    update shows set
      title = ${title},
      description = ${description},
      style_guide = ${styleGuide},
      voice_id = ${voiceId},
      cadence = ${cadence},
      schedule_time = ${scheduleTime},
      timezone = ${timezone},
      target_minutes = ${targetMinutes},
      is_active = ${isActive},
      next_run_at = case
        when ${cadence} = 'manual' then null
        when next_run_at is not null and not ${resetSchedule} then next_run_at
        else ${firstRun}::timestamptz
      end
    where id = ${id}
    returning *
  `) as Show[];

  return NextResponse.json({ show: rows[0] });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  // Delete the show row first, in one statement that also reports its episode ids.
  // The cascade takes its runs (queued or in flight), episodes and next_run_at with it,
  // so the scheduler can't start a new run while we clean up audio. A run already in
  // flight notices its episode is gone and removes its own audio (lib/generate.ts).
  // TODO(D4): api_tokens have no per-show scope yet; when they do, revoke those here.
  const rows = (await sql`
    with eps as (select id from episodes where show_id = ${id}),
         gone as (delete from shows where id = ${id} returning id)
    select (select count(*) from gone)::int as deleted,
           coalesce((select array_agg(id) from eps), '{}') as episode_ids
  `) as { deleted: number; episode_ids: string[] }[];
  const result = rows[0];
  if (!result?.deleted) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  const storage = getStorage();
  for (const episodeId of result.episode_ids) {
    await storage.delete(episodeId);
  }
  return NextResponse.json({ ok: true });
}
