import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { reapStuckRuns } from "@/lib/reap-runs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  await reapStuckRuns();
  const { id } = await params;
  const rows = (await sql`
    select r.status, r.model, r.error, r.episode_id, r.started_at, r.finished_at
    from runs r join shows s on s.id = r.show_id
    where r.id = ${id}
      and (s.user_id = ${caller.userId} or (${caller.role} = 'owner' and ${caller.ownerApproved}))
  `) as {
    status: string;
    model: string | null;
    error: string | null;
    episode_id: string | null;
    started_at: string;
    finished_at: string | null;
  }[];
  const run = rows[0];
  if (!run) return NextResponse.json({ error: "We couldn't find that run." }, { status: 404 });

  return NextResponse.json({
    status: run.status,
    model: run.model,
    error: run.error,
    episodeId: run.episode_id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  });
}
