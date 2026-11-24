import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkParticipantPatch, updateParticipant } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";

// Owner-only moderation: { role?, muted?, removed? }.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  return liveRoute(req, { sessionId: id, ownerOnly: true }, async () => {
    const patch = checkParticipantPatch(await req.json().catch(() => null));
    return NextResponse.json({ participant: await updateParticipant(sql, id, pid, patch) });
  });
}
