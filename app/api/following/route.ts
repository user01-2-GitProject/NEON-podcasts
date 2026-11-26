import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listFollowingFeed } from "@/lib/catalog";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest published episodes from shows the caller follows, with playable audio URLs.
export async function GET(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  return NextResponse.json({ episodes: await listFollowingFeed(sql, email) });
}
