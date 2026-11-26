import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { leaveSession } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";

// Self-service: leave the session. Turns already posted stay in the transcript.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async (caller) => {
    if (!(await leaveSession(sql, caller, id))) {
      return NextResponse.json({ error: "You're not in this live show." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  });
}
