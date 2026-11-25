import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { extractDocumentText } from "@/lib/documents";
import { fetchPageText } from "@/lib/fetch-page";
import type { Briefing } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const briefings = (await sql`
    select * from show_briefings where show_id = ${id} order by uploaded_at desc
  `) as Briefing[];
  return NextResponse.json({ briefings });
}

// Source material for a show, from a phone or a computer:
//   multipart "file"            a PDF, Word (.docx), text or web page file
//   multipart filename+content  pasted text (older clients)
//   JSON { filename, content_md } pasted text
//   JSON { url }                a public web page or PDF, fetched once
// Errors are plain sentences the person can act on.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;

  const shows = (await sql`select id from shows where id = ${id}`) as { id: string }[];
  if (!shows[0]) return NextResponse.json({ error: "That show doesn't exist anymore." }, { status: 404 });

  let filename = "";
  let content = "";
  let truncated = false;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "That upload didn't come through. Try again." }, { status: 400 });
    const file = form.get("file");
    if (file && typeof file !== "string") {
      filename = file.name || "Document";
      const out = await extractDocumentText(new Uint8Array(await file.arrayBuffer()), file.name || "", file.type || "");
      if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
      content = out.text;
      truncated = out.truncated;
    } else {
      filename = (form.get("filename") as string) || "Notes";
      content = (form.get("content_md") as string) || "";
    }
  } else {
    const body = await req.json().catch(() => ({}));
    if (typeof body.url === "string" && body.url.trim()) {
      const out = await fetchPageText(body.url);
      if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
      content = `Source: ${body.url.trim()}\n\n${out.text}`;
      truncated = out.truncated;
      filename = (body.filename || out.title || new URL(body.url.trim()).hostname).toString();
    } else {
      filename = (body.filename || "Notes").toString();
      content = (body.content_md || "").toString();
    }
  }

  if (!content.trim()) {
    return NextResponse.json({ error: "There's no text in that yet. Paste or type something first." }, { status: 400 });
  }
  filename = filename.slice(0, 200);

  const rows = (await sql`
    insert into show_briefings (show_id, filename, content_md, is_active)
    values (${id}, ${filename}, ${content}, true)
    returning *
  `) as Briefing[];

  return NextResponse.json({ briefing: rows[0], truncated }, { status: 201 });
}
