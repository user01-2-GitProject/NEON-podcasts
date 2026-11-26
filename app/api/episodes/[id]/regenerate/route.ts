import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { friendlyGenerateError, sanitizeError } from "@/lib/errors";
import { generateEpisode } from "@/lib/generate";
import { checkGeneration } from "@/lib/limits";

export const runtime = "nodejs";
// Rewrites the script and voices it again, so it can take a while.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// "Regenerate with the latest setup": a fresh run from the show's current
// style guide, briefings and voice, written back onto the SAME episode row.
// The id (and therefore the audio URL) stays put so RSS listeners keep working.
// Non-GET API routes are already owner-only in middleware.ts.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const caller = await currentCaller({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const decision = await checkGeneration(sql, {
    userId: caller.userId,
    isOwner: caller.role === "owner" && caller.ownerApproved,
  });
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 429 });

  try {
    const episodes = (await sql`
      select id, show_id from episodes where id = ${id}
    `) as { id: string; show_id: string }[];
    const episode = episodes[0];
    if (!episode) {
      return NextResponse.json({ error: "We couldn't find that episode." }, { status: 404 });
    }

    const runs = (await sql`
      insert into runs (show_id, episode_id, status)
      values (${episode.show_id}, ${episode.id}, 'running')
      returning id
    `) as { id: string }[];
    const runId = runs[0].id;

    // No mode override: the show's current narration_mode decides whether the
    // result is published with audio or saved as a script-only draft.
    const { episode: updated, runId: usedRunId, voiceError } = await generateEpisode(
      episode.show_id,
      undefined,
      undefined,
      { episodeId: episode.id, runId },
    );
    return NextResponse.json(
      { episode: updated, runId: usedRunId, voice_error: voiceError ?? null },
      { status: 200 },
    );
  } catch (err) {
    sanitizeError(err, "regenerateEpisode");
    const { message, status } = friendlyGenerateError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
