import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { firstSlot } from "@/lib/cadence";
import { currentUserId } from "@/lib/me";
import { coerceShowSpec, parseShowMd, specToShowFields, validateShowSpec, MAX_SPEC_BYTES } from "@/lib/show-spec";
import type { Show } from "@/lib/types";

export const runtime = "nodejs";

// Create a show from the canonical spec: either { markdown: "<show.md>" } (the
// file door) or { spec: {...} } (the form door). Both go through the same
// validator and produce the same row, style guide and pronunciation lexicon.
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_SPEC_BYTES * 2) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  let body: { markdown?: unknown; spec?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let spec;
  let errors: string[];
  if (typeof body.markdown === "string") {
    ({ spec, errors } = parseShowMd(body.markdown));
  } else if (body.spec !== undefined) {
    spec = coerceShowSpec(body.spec);
    errors = validateShowSpec(spec);
  } else {
    return NextResponse.json({ error: "send { markdown } or { spec }" }, { status: 400 });
  }
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const f = specToShowFields(spec);
  const firstRun = firstSlot(f.cadence, f.schedule_time, f.timezone)?.toISOString() ?? null;
  const userId = await currentUserId(req);
  const terms = spec.pronunciations.map((p) => p.term);
  const sayAs = spec.pronunciations.map((p) => p.say_as);
  const modes = spec.pronunciations.map((p) => p.match);

  // One statement, so the show and its lexicon land together or not at all.
  const rows = (await sql`
    with s as (
      insert into shows
        (user_id, title, description, style_guide, voice_id, narration_mode, cadence,
         schedule_time, timezone, target_minutes, image_url, next_run_at)
      values
        (${userId}, ${f.title}, ${f.description}, ${f.style_guide}, ${f.voice_id},
         ${f.narration_mode}, ${f.cadence}, ${f.schedule_time}, ${f.timezone},
         ${f.target_minutes}, ${f.image_url},
         ${firstRun}::timestamptz)
      returning *
    ),
    p as (
      insert into show_pronunciations (show_id, term, say_as, match_mode)
      select s.id, t.term, t.say_as, t.match_mode
      from s, unnest(${terms}::text[], ${sayAs}::text[], ${modes}::text[]) as t(term, say_as, match_mode)
    )
    select * from s
  `) as Show[];

  return NextResponse.json({ show: rows[0] }, { status: 201 });
}
