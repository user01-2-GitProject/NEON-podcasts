import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listBrowse } from "@/lib/catalog";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shows with at least one published episode, flagged with whether the caller follows them.
export async function GET(req: Request) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  return NextResponse.json({ shows: await listBrowse(sql, email) });
}
