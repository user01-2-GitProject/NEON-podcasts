import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkTurn, getSession, listTurns, postTurn } from "@/lib/live";
import { liveRoute } from "@/lib/live-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Polling feed: GET ?after=<seq> returns up to 200 newer turns, oldest first.
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async () => {
    if (!(await getSession(sql, id))) return NextResponse.json({ error: "We couldn't find that live show." }, { status: 404 });
    const turns = await listTurns(sql, id, new URL(req.url).searchParams.get("after"));
    return NextResponse.json({ turns });
  });
}

// Self-service: speak or chat as the caller's own participant. Body: { kind, text }.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return liveRoute(req, { sessionId: id }, async (caller) => {
    const turn = checkTurn(await req.json().catch(() => null));
    return NextResponse.json(await postTurn(sql, caller, id, turn), { status: 201 });
  });
}
