import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkDisplayName, joinSession } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";

// Self-service: join (or rejoin) as the caller. Body: { display_name }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async (caller) => {
    const displayName = checkDisplayName(await req.json().catch(() => null));
    return NextResponse.json({ participant: await joinSession(sql, caller, id, displayName) });
  });
}
