import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/me";
import { listMyTokens, revokeAllMyTokens } from "@/lib/me-tokens";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tokens = await listMyTokens(sql, userId);
  return NextResponse.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const revoked = await revokeAllMyTokens(sql, userId);
  return NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
}
