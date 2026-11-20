import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
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
  const voiceId = body.voice_id !== undefined ? (body.voice_id ? body.voice_id.toString() : null) : show.voice_id;
  const cadence =
    body.cadence !== undefined && ["daily", "weekly", "manual"].includes(body.cadence)
      ? body.cadence
      : show.cadence;
  const scheduleTime = body.schedule_time !== undefined ? body.schedule_time.toString() : show.schedule_time;
  const timezone = body.timezone !== undefined ? body.timezone.toString() : show.timezone;
  const targetMinutes =
    body.target_minutes !== undefined && Number.isFinite(Number(body.target_minutes))
      ? Math.max(1, Math.min(120, Math.round(Number(body.target_minutes))))
      : show.target_minutes;
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : show.is_active;

  const rows = (await sql`
    update shows set
      title = ${title},
      description = ${description},
      voice_id = ${voiceId},
      cadence = ${cadence},
      schedule_time = ${scheduleTime},
      timezone = ${timezone},
      target_minutes = ${targetMinutes},
      is_active = ${isActive}
    where id = ${id}
    returning *
  `) as Show[];

  return NextResponse.json({ show: rows[0] });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await sql`delete from shows where id = ${id}`;
  return NextResponse.json({ ok: true });
}
