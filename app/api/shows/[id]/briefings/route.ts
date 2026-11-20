import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import type { Briefing } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const briefings = (await sql`
    select * from show_briefings where show_id = ${id} order by uploaded_at desc
  `) as Briefing[];
  return NextResponse.json({ briefings });
}

// Accepts either a multipart file upload (field "file") or JSON { filename, content_md }.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;

  const shows = (await sql`select id from shows where id = ${id}`) as { id: string }[];
  if (!shows[0]) return NextResponse.json({ error: "show not found" }, { status: 404 });

  let filename = "";
  let content = "";

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (file && typeof file !== "string") {
      filename = file.name || "briefing.md";
      content = await file.text();
    } else {
      filename = (form.get("filename") as string) || "briefing.md";
      content = (form.get("content_md") as string) || "";
    }
  } else {
    const body = await req.json().catch(() => ({}));
    filename = (body.filename || "briefing.md").toString();
    content = (body.content_md || "").toString();
  }

  if (!content.trim()) {
    return NextResponse.json({ error: "briefing content is empty" }, { status: 400 });
  }

  const rows = (await sql`
    insert into show_briefings (show_id, filename, content_md, is_active)
    values (${id}, ${filename}, ${content}, true)
    returning *
  `) as Briefing[];

  return NextResponse.json({ briefing: rows[0] }, { status: 201 });
}
