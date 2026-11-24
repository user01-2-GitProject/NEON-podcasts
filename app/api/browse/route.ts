import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listBrowse } from "@/lib/catalog";
import { subscriberEmail } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shows with at least one published episode, flagged with whether the caller follows them.
export async function GET() {
  const email = subscriberEmail(await auth());
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ shows: await listBrowse(sql, email) });
}
