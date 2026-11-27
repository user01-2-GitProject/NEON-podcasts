import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkCover, uploadedCoverPath } from "@/lib/cover-upload";
import { stampOfficialCover } from "@/lib/cover";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const MISSING_TABLE = "Cover uploads aren't switched on yet (the database needs one small update).";

// Upload a cover picture (form field "file"). Owner-only, like every non-GET
// /api route (middleware). The picture is checked against Apple's rules
// before it's stored, then served from /art/[id].
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  const shows = (await sql`select id, is_official from shows where id = ${id}`) as { id: string; is_official: boolean }[];
  if (!shows[0]) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Pick a picture to upload." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = checkCover(bytes);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  let storedBytes: Uint8Array = bytes;
  let contentType = checked.contentType;
  if (shows[0].is_official) {
    try {
      storedBytes = await stampOfficialCover(bytes);
      contentType = "image/jpeg";
    } catch {
      return NextResponse.json({ error: "We couldn't prepare that official cover. Try another picture." }, { status: 400 });
    }
  }

  try {
    await sql`
      insert into show_artwork (show_id, content_type, data, updated_at)
      values (${id}, ${contentType}, decode(${Buffer.from(storedBytes).toString("base64")}, 'base64'), now())
      on conflict (show_id) do update
        set content_type = excluded.content_type, data = excluded.data, updated_at = now()
    `;
  } catch (err) {
    console.error("[artwork] store failed", err);
    return NextResponse.json({ error: MISSING_TABLE }, { status: 503 });
  }
  const imageUrl = uploadedCoverPath(id);
  await sql`update shows set image_url = ${imageUrl} where id = ${id}`;
  return NextResponse.json({ image_url: imageUrl });
}

// Go back to the free cover made from the show's name.
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  await sql`delete from show_artwork where show_id = ${id}`.catch(() => undefined);
  await sql`update shows set image_url = null where id = ${id}`;
  return NextResponse.json({ image_url: null });
}
