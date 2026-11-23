import { NextResponse } from "next/server";
import { generateEpisode } from "@/lib/generate";
import { sanitizeError } from "@/lib/errors";
import type { NarrationMode } from "@/lib/types";

export const runtime = "nodejs";
// Generation calls Claude + TTS and can take a while.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    // Optional per-run override. Omit to use the show's narration_mode.
    const body = await req.json().catch(() => ({}));
    const raw = body?.mode ?? new URL(req.url).searchParams.get("mode");
    const mode: NarrationMode | undefined =
      raw === "external" ? "external" : raw === "auto" ? "auto" : undefined;

    const { episode, runId } = await generateEpisode(id, mode);
    return NextResponse.json({ episode, runId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeError(err, "generateEpisode") },
      { status: 500 }
    );
  }
}
