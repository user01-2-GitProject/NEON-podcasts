import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { generateEpisode } from "@/lib/generate";
import { friendlyGenerateError, sanitizeError } from "@/lib/errors";
import { checkGeneration } from "@/lib/limits";
import { captureServerException } from "@/sentry.server.config";
import { runGenerationInBackground } from "@/lib/run-generation";

export const runtime = "nodejs";
// Script generation runs in the background; TTS uses the longer audio route.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  // Cost guardrail: owners are unlimited, everyone else has a daily cap.
  const decision = await checkGeneration(sql, {
    userId: caller.userId,
    isOwner: caller.role === "owner" && caller.ownerApproved,
  });
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 429 });
  try {
    const runs = (await sql`
      insert into runs (show_id, status) values (${id}, 'running') returning id
    `) as { id: string }[];
    const runId = runs[0].id;
    // Save the script first. For auto narration, the client then POSTs
    // { runId } to /api/episodes/[episodeId]/audio after this run exposes its draft.
    after(() => runGenerationInBackground(runId, () => generateEpisode(id, "external", undefined, undefined, runId)));
    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    sanitizeError(err, "generateEpisode"); // logs the full details
    captureServerException(err, "generateEpisode"); // reports to Sentry in prod only
    const { message, status } = friendlyGenerateError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
