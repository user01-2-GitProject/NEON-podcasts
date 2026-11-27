import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import {
  findCouncilEpisode,
  parseStoredFactCheck,
  publishIfReady,
  saveCouncilFactCheck,
} from "@/lib/council";
import { mergeCouncilResult, overrideScriptGrade, validateCouncilSubmission } from "@/lib/fact-check";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Agent-facing: the Lead submits one council result per pending episode. The
// route owns the verdict rule (validateCouncilSubmission recomputes it), the
// grade and the durable write; callers cannot hand us a pre-baked pass.
export async function POST(req: Request, { params }: Params) {
  const authHeader = req.headers.get("authorization") || "";
  if (!/^Bearer npt_[0-9a-f]{64}$/i.test(authHeader)) {
    return NextResponse.json({ error: "Use a NEON agent token." }, { status: 401 });
  }
  const caller = await currentCaller({
    session: await auth(),
    authHeader,
    db: sql,
  });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await params;
  const episode = await findCouncilEpisode(sql, id, caller.userId);
  if (!episode || !episode.run_id) {
    return NextResponse.json({ error: "We couldn't find that episode." }, { status: 404 });
  }

  const checked = validateCouncilSubmission(await req.json().catch(() => null));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const merged = mergeCouncilResult(parseStoredFactCheck(episode.fact_check), checked.value, new Date());
  await saveCouncilFactCheck(sql, episode.run_id, episode.show_id, merged);
  const published = await publishIfReady(sql, {
    episodeId: episode.episode_id,
    showId: episode.show_id,
    status: episode.status,
    audioUrl: episode.audio_url,
    optedIn: episode.fact_check_council === true,
    verdict: checked.value.verdict,
  });

  return NextResponse.json({ ok: true, fact_check: merged, published });
}

export async function PATCH(req: Request, { params }: Params) {
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { id } = await params;
  const episode = await findCouncilEpisode(sql, id, caller.userId);
  if (!episode || !episode.run_id) return NextResponse.json({ error: "We couldn't find that episode." }, { status: 404 });
  const body = await req.json().catch(() => null) as { score?: unknown; notes?: unknown } | null;
  if (!body || !["A", "B", "C", "D", "F"].includes(String(body.score)) || typeof body.notes !== "string" || !body.notes.trim() || body.notes.length > 1000) {
    return NextResponse.json({ error: "Choose a grade and enter notes up to 1000 characters." }, { status: 400 });
  }
  const factCheck = parseStoredFactCheck(episode.fact_check);
  if (!factCheck?.grade) return NextResponse.json({ error: "This episode has no council grade to override." }, { status: 409 });
  const updated = { ...factCheck, grade: overrideScriptGrade(factCheck.grade, body.score as "A" | "B" | "C" | "D" | "F", body.notes) };
  await saveCouncilFactCheck(sql, episode.run_id, episode.show_id, updated);
  return NextResponse.json({ ok: true, grade: updated.grade });
}
