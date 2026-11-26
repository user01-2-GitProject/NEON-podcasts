import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import type { Pronunciation } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const pronunciations = (await sql`
    select * from show_pronunciations where show_id = ${id} order by created_at asc
  `) as Pronunciation[];
  return NextResponse.json({ pronunciations });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const term = body.term !== undefined ? body.term.toString().trim() : "";
  const sayAs = body.say_as !== undefined ? body.say_as.toString().trim() : "";
  if (!term || !sayAs) {
    return NextResponse.json({ error: "Fill in both the word and how to say it." }, { status: 400 });
  }

  const matchMode = body.match_mode === undefined ? "word" : body.match_mode;
  if (matchMode !== "word" && matchMode !== "substring") {
    return NextResponse.json({ error: "Pick whether it matches the whole word or any part of a word." }, { status: 400 });
  }

  const rows = (await sql`
    insert into show_pronunciations (show_id, term, say_as, match_mode)
    values (${id}, ${term}, ${sayAs}, ${matchMode})
    returning *
  `) as Pronunciation[];

  return NextResponse.json({ pronunciation: rows[0] }, { status: 201 });
}
