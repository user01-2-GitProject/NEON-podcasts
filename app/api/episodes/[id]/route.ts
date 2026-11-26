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
  let body: { status?: unknown; is_official?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err, "episode patch") }, { status: 400 });
  }

  const hasStatus = body?.status !== undefined;
  const hasOfficial = body?.is_official !== undefined;
  const status = hasStatus ? body.status : null;
  const official = hasOfficial ? body.is_official : false;

  // Either field may be sent on its own, but anything sent has to be valid.
  // Validation errors stay in plain words, like the rest of the episode API.
  if (hasStatus && status !== "published" && status !== "draft") {
    return NextResponse.json(
      { error: safeErrorMessage("An episode can only be published or a draft.") },
      { status: 400 }
    );
  }
  if (hasOfficial && typeof official !== "boolean") {
    return NextResponse.json(
      { error: safeErrorMessage("The official flag must be true or false.") },
      { status: 400 }
    );
  }
  if (!hasStatus && !hasOfficial) {
    return NextResponse.json(
      { error: safeErrorMessage("An episode can only be published or a draft.") },
      { status: 400 }
    );
  }

  try {
    let rows: Episode[];
    if (hasOfficial) {
      // One update keeps status and badge changes together. A status-only patch
      // never mentions the new column, so it keeps working before migration 014.
      rows = (await sql`
        update episodes set
          status = coalesce(${status}::text, status),
          published_at = case
            when ${status}::text = 'published' then coalesce(published_at, now())
            else published_at
          end,
          is_official = ${official}
        where id = ${id} returning *
      `) as Episode[];
    } else if (status === "published") {
      rows = (await sql`
          update episodes set status = 'published', published_at = coalesce(published_at, now())
          where id = ${id} returning *
        `) as Episode[];
    } else {
      rows = (await sql`
          update episodes set status = 'draft'
          where id = ${id} returning *
        `) as Episode[];
    }

    if (!rows[0]) {
      return NextResponse.json({ error: "We couldn't find that episode." }, { status: 404 });
    }
    return NextResponse.json({ episode: rows[0] }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err, "episode patch") }, { status: 500 });
  }
}
