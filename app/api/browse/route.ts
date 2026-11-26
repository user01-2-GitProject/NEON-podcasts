import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listBrowse } from "@/lib/catalog";
import { currentUserEmail } from "@/lib/current-user";
import { getHomeRails } from "@/lib/home-rails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shows with at least one published episode, flagged with whether the caller follows them.
export async function GET(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  // ?rails=1 returns the four home shelves alongside the browse list, so a
  // client needs one call instead of one per rail. Default response is
  // unchanged for the native app's existing /api/browse consumers.
  const withRails = new URL(req.url).searchParams.get("rails") === "1";
  const [shows, rails] = await Promise.all([
    listBrowse(sql, email),
    withRails ? getHomeRails(sql, email) : Promise.resolve(undefined),
  ]);
  return NextResponse.json(rails ? { shows, rails } : { shows });
}
