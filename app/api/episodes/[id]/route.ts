import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { safeErrorMessage, sanitizeError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import type { Episode } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await getStorage().delete(id);
  await sql`delete from episodes where id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err, "episode patch") }, { status: 400 });
  }

  if (body?.status !== "published" && body?.status !== "draft") {
    return NextResponse.json(
      { error: safeErrorMessage("Status must be published or draft") },
      { status: 400 }
    );
  }

  try {
    const rows = body.status === "published"
      ? (await sql`
          update episodes set status = 'published', published_at = coalesce(published_at, now())
          where id = ${id} returning *
        `) as Episode[]
      : (await sql`
          update episodes set status = 'draft'
          where id = ${id} returning *
        `) as Episode[];

    if (!rows[0]) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    return NextResponse.json({ episode: rows[0] }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err, "episode patch") }, { status: 500 });
  }
}
