import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, listParticipants, setSessionStatus } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The session plus who is present (display names and kind only, never emails).
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async () => {
    const session = await getSession(sql, id);
    if (!session) return NextResponse.json({ error: "We couldn't find that live show." }, { status: 404 });
    return NextResponse.json({ session, participants: await listParticipants(sql, id) });
  });
}

// Owner-only: { status: "live" | "ended" }.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id, ownerOnly: true }, async () => {
    const body: unknown = await req.json().catch(() => null);
    const status = body !== null && typeof body === "object" && "status" in body ? body.status : undefined;
    return NextResponse.json({ session: await setSessionStatus(sql, id, status) });
  });
}
