import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ownerId } from "@/lib/token-owner";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await ownerId())) return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "We couldn't find that key." }, { status: 404 });
  }
  const rows = (await sql`
    update api_tokens set revoked_at = now()
    where id = ${id} and revoked_at is null returning id
  `) as { id: string }[];
  if (!rows[0]) return NextResponse.json({ error: "We couldn't find that key." }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
