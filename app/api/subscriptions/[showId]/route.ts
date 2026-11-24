import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { subscriberEmail, unfollow } from "@/lib/subscriptions";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params;
  const email = subscriberEmail(await auth());
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(showId)) {
    return NextResponse.json({ error: "show_id is required" }, { status: 400 });
  }
  await unfollow(sql, email, showId);
  return NextResponse.json({ ok: true });
}
