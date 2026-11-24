import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkNewSession, createSession, listSessions } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scheduled and live sessions. Any valid token or session may read.
export async function GET(req: Request) {
  return liveRoute(req, {}, async () => NextResponse.json({ sessions: await listSessions(sql) }));
}

// Owner-only: create a scheduled session.
export async function POST(req: Request) {
  return liveRoute(req, { ownerOnly: true }, async (caller) => {
    const input = checkNewSession(await req.json().catch(() => null));
    return NextResponse.json({ session: await createSession(sql, caller, input) }, { status: 201 });
  });
}
