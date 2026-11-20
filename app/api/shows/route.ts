import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
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
  const cadence = ["daily", "weekly", "manual"].includes(body.cadence) ? body.cadence : "weekly";
  const scheduleTime = (body.schedule_time || "09:00").toString();
  const timezone = (body.timezone || "UTC").toString();
  const targetMinutes = Number.isFinite(Number(body.target_minutes))
    ? Math.max(1, Math.min(120, Math.round(Number(body.target_minutes))))
    : 5;

  const rows = (await sql`
    insert into shows
      (title, description, voice_id, narration_mode, cadence, schedule_time, timezone, target_minutes)
    values
      (${title}, ${description}, ${voiceId}, ${narrationMode}, ${cadence}, ${scheduleTime}, ${timezone}, ${targetMinutes})
    returning *
  `) as Show[];

  return NextResponse.json({ show: rows[0] }, { status: 201 });
}
