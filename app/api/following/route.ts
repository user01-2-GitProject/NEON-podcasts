import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listFollowingFeed } from "@/lib/catalog";
import { subscriberEmail } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest published episodes from shows the caller follows, with playable audio URLs.
export async function GET() {
  const email = subscriberEmail(await auth());
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ episodes: await listFollowingFeed(sql, email) });
}
