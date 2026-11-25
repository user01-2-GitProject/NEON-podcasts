import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { firstSlot, isCadence } from "@/lib/cadence";
import { currentUserId } from "@/lib/me";
import { scheduleError } from "@/lib/schedule";
import { parseImageUrl } from "@/lib/show-image";
import type { Show } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const shows = (await sql`select * from shows order by created_at desc`) as Show[];
  return NextResponse.json({ shows });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const title = (body.title || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const description = (body.description || "").toString();
  const voiceId = body.voice_id ? body.voice_id.toString() : null;
  const narrationMode = body.narration_mode === "external" ? "external" : "auto";
  const cadence = isCadence(body.cadence) ? body.cadence : "weekly";
  const scheduleTime = (body.schedule_time || "09:00").toString();
  const timezone = (body.timezone || "UTC").toString();
  const invalidSchedule = cadence === "manual" ? null : scheduleError(scheduleTime, timezone);
  if (invalidSchedule) {
    return NextResponse.json({ error: invalidSchedule }, { status: 400 });
  }
  const targetMinutes = Number.isFinite(Number(body.target_minutes))
    ? Math.max(1, Math.min(120, Math.round(Number(body.target_minutes))))
    : 5;
  const image = body.image_url !== undefined ? parseImageUrl(body.image_url) : { value: null };
  if ("error" in image) return NextResponse.json({ error: image.error }, { status: 400 });
  // The creator owns the show; generation usage and limits are charged to them.
  const firstRun = firstSlot(cadence, scheduleTime, timezone)?.toISOString() ?? null;
  const userId = await currentUserId(req);

  const rows = (await sql`
    insert into shows
      (user_id, title, description, voice_id, narration_mode, cadence, schedule_time, timezone,
       target_minutes, next_run_at)
    values
      (${userId}, ${title}, ${description}, ${voiceId}, ${narrationMode}, ${cadence}, ${scheduleTime},
       ${timezone}, ${targetMinutes},
       ${firstRun}::timestamptz)
    returning *
  `) as Show[];
  // Set separately so creating shows keeps working before migration 009.
  if (image.value) {
    const updated = (await sql`
      update shows set image_url = ${image.value} where id = ${rows[0].id} returning *
    `) as Show[];
    return NextResponse.json({ show: updated[0] }, { status: 201 });
  }

  return NextResponse.json({ show: rows[0] }, { status: 201 });
}
