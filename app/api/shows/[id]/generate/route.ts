import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { generateEpisode } from "@/lib/generate";
import { friendlyGenerateError, sanitizeError } from "@/lib/errors";
import { checkGeneration } from "@/lib/limits";
import type { NarrationMode } from "@/lib/types";

export const runtime = "nodejs";
// Generation calls Claude + TTS and can take a while.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Cost guardrail: owners are unlimited, everyone else has a daily cap.
  const decision = await checkGeneration(sql, {
    userId: caller.userId,
    isOwner: caller.role === "owner" && caller.ownerApproved,
  });
  if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 429 });
  try {
    // Optional per-run override. Omit to use the show's narration_mode.
    const body = await req.json().catch(() => ({}));
    const raw = body?.mode ?? new URL(req.url).searchParams.get("mode");
    const mode: NarrationMode | undefined =
      raw === "external" ? "external" : raw === "auto" ? "auto" : undefined;

    const { episode, runId, voiceError, scriptQa } = await generateEpisode(id, mode);
    // QA notes are also stored on runs.script_qa (jsonb); echoing them here
    // lets the panel show the count as soon as generation finishes.
    return NextResponse.json(
      { episode, runId, voice_error: voiceError ?? null, script_qa: scriptQa ?? null },
      { status: 201 },
    );
  } catch (err) {
    sanitizeError(err, "generateEpisode"); // logs the full details
    const { message, status } = friendlyGenerateError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
