import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import type { Briefing } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; briefingId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id, briefingId } = await params;
  const body = await req.json().catch(() => ({}));
  const isActive = Boolean(body.is_active);

  const rows = (await sql`
    update show_briefings set is_active = ${isActive}
    where id = ${briefingId} and show_id = ${id}
    returning *
  `) as Briefing[];
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ briefing: rows[0] });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, briefingId } = await params;
  await sql`delete from show_briefings where id = ${briefingId} and show_id = ${id}`;
  return NextResponse.json({ ok: true });
}
