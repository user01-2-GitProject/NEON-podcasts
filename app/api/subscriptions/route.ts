import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { follow, listFollows, showExists } from "@/lib/subscriptions";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  return NextResponse.json({ show_ids: await listFollows(sql, email) });
}

export async function POST(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const showId = body?.show_id;
  if (typeof showId !== "string" || !/^[0-9a-f-]{36}$/i.test(showId)) {
    return NextResponse.json({ error: "Pick a show first." }, { status: 400 });
  }
  if (!(await showExists(sql, showId))) {
    return NextResponse.json({ error: "We couldn't find that show." }, { status: 400 });
  }
  await follow(sql, email, showId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
