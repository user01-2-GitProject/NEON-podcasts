import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { AWAY_AFTER_SECONDS, heartbeat } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";

// Self-service: keep the caller marked present (away after AWAY_AFTER_SECONDS of silence).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async (caller) => {
    if (!(await heartbeat(sql, caller, id))) {
      return NextResponse.json({ error: "you are not in this session" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, away_after_seconds: AWAY_AFTER_SECONDS });
  });
}
