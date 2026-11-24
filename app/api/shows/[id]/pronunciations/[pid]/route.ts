import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; pid: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id, pid } = await params;
  await sql`delete from show_pronunciations where id = ${pid} and show_id = ${id}`;
  return NextResponse.json({ ok: true });
}
