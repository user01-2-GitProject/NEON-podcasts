import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { firstSlot } from "@/lib/cadence";
import {
  coerceShowSpec,
  parseShowMd,
  showToSpec,
  specToShowFields,
  toShowMd,
  validateShowSpec,
  MAX_SPEC_BYTES,
} from "@/lib/show-spec";
import type { Pronunciation, Show } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function filename(title: string): string {
  return (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "show") + ".md";
}

// Export the show as a canonical show.md (?format=json returns the spec).
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const shows = (await sql`select * from shows where id = ${id}`) as Show[];
  if (!shows[0]) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  const prons = (await sql`
    select * from show_pronunciations where show_id = ${id} order by created_at asc, term asc
  `) as Pronunciation[];
  const spec = showToSpec(shows[0], prons);
  if (new URL(req.url).searchParams.get("format") === "json") {
    return NextResponse.json({ spec }, { headers: { "Cache-Control": "no-store" } });
  }
  return new Response(toShowMd(spec), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(spec.title)}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Replace the show's spec from { markdown } or { spec }: same validation as
// create. Updates the show row and swaps the pronunciation lexicon in one
// statement. Briefings, episodes, rss_token and is_public are untouched.
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const raw = await req.text();
  if (raw.length > MAX_SPEC_BYTES * 2) {
    return NextResponse.json({ error: "That's too big to send. Try something smaller." }, { status: 413 });
  }
  let body: { markdown?: unknown; spec?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "That request didn't come through right. Try again." }, { status: 400 });
  }
  let spec;
  let errors: string[];
  if (typeof body.markdown === "string") {
    ({ spec, errors } = parseShowMd(body.markdown));
  } else if (body.spec !== undefined) {
    spec = coerceShowSpec(body.spec);
    errors = validateShowSpec(spec);
  } else {
    return NextResponse.json({ error: "Send the show setup as { markdown } or { spec }." }, { status: 400 });
  }
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  const f = specToShowFields(spec);
  const terms = spec.pronunciations.map((p) => p.term);
  const sayAs = spec.pronunciations.map((p) => p.say_as);
  const modes = spec.pronunciations.map((p) => p.match);

  const firstRun = firstSlot(f.cadence, f.schedule_time, f.timezone, new Date(), f.air_days)?.toISOString() ?? null;
  const rows = (await sql`
    with s as (
      update shows set
        title = ${f.title},
        description = ${f.description},
        style_guide = ${f.style_guide},
        voice_id = ${f.voice_id},
        hosts = ${JSON.stringify(f.hosts)}::jsonb,
        narration_mode = ${f.narration_mode},
        cadence = ${f.cadence},
        schedule_time = ${f.schedule_time},
        timezone = ${f.timezone},
        target_minutes = ${f.target_minutes},
        image_url = case
          when ${f.image_url}::text is null and image_url like '/art/%' then image_url
          else ${f.image_url}
        end,
        air_days = ${f.air_days}::smallint[],
        next_run_at = case
          when ${f.cadence} = 'manual' then null
          when next_run_at is not null and cadence = ${f.cadence}
               and schedule_time = ${f.schedule_time} and timezone = ${f.timezone}
               and air_days is not distinct from ${f.air_days}::smallint[] then next_run_at
          when not is_active then next_run_at
          else ${firstRun}::timestamptz
        end
      where id = ${id}
      returning *
    ),
    d as (
      delete from show_pronunciations where show_id in (select id from s)
    ),
    p as (
      insert into show_pronunciations (show_id, term, say_as, match_mode)
      select s.id, t.term, t.say_as, t.match_mode
      from s, unnest(${terms}::text[], ${sayAs}::text[], ${modes}::text[]) as t(term, say_as, match_mode)
    )
    select * from s
  `) as Show[];
  if (!rows[0]) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  return NextResponse.json({ show: rows[0] });
}
