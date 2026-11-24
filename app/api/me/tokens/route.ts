import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/me";
import { createAgentToken, listMyTokens, parseAgentTokenInput, revokeAllMyTokens } from "@/lib/me-tokens";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (typeof email !== "string" || email.length === 0) {
    return NextResponse.json({ error: "session required" }, { status: 403 });
  }

  const users = (await sql`select id from users where email = ${email} limit 1`) as { id: string }[];
  const userId = users[0]?.id;
  if (!userId) return NextResponse.json({ error: "session required" }, { status: 403 });

  const input = parseAgentTokenInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "invalid label or scope" }, { status: 400 });

  const token = await createAgentToken(sql, userId, input.label, input.scope);
  return NextResponse.json(token, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tokens = await listMyTokens(sql, userId);
  return NextResponse.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const revoked = await revokeAllMyTokens(sql, userId);
  return NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
}
