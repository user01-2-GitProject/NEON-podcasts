import { NextResponse } from "next/server";
import { generateEpisode } from "@/lib/generate";

export const runtime = "nodejs";
// Generation calls Claude + TTS and can take a while.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const { episode, runId } = await generateEpisode(id);
    return NextResponse.json({ episode, runId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
