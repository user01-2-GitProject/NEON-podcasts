import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { follow, listFollows, showExists, subscriberEmail } from "@/lib/subscriptions";

export const runtime = "nodejs";

export async function GET() {
  const email = subscriberEmail(await auth());
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ show_ids: await listFollows(sql, email) });
}

export async function POST(req: Request) {
  const email = subscriberEmail(await auth());
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const showId = body?.show_id;
  if (typeof showId !== "string" || !/^[0-9a-f-]{36}$/i.test(showId)) {
    return NextResponse.json({ error: "show_id is required" }, { status: 400 });
  }
  if (!(await showExists(sql, showId))) {
    return NextResponse.json({ error: "show not found" }, { status: 400 });
  }
  await follow(sql, email, showId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
