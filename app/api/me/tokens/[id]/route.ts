import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/me";
import { revokeMyToken } from "@/lib/me-tokens";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "We couldn't find that device." }, { status: 404 });
  }
  const ok = await revokeMyToken(sql, userId, id);
  if (!ok) return NextResponse.json({ error: "We couldn't find that device." }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
