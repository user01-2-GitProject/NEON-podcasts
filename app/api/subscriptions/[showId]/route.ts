import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { unfollow } from "@/lib/subscriptions";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(showId)) {
    return NextResponse.json({ error: "show_id is required" }, { status: 400 });
  }
  await unfollow(sql, email, showId);
  return NextResponse.json({ ok: true });
}
