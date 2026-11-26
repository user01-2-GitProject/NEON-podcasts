import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { getShowByToken } from "@/lib/catalog";
import { currentUserEmail } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

// A show's published episodes for the native app's show screen.
export async function GET(req: Request, { params }: Params) {
  const email = await currentUserEmail({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!email) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  const detail = await getShowByToken(sql, token);
  if (!detail) return NextResponse.json({ error: "We couldn't find that show." }, { status: 404 });
  return NextResponse.json(detail);
}
