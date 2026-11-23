import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { newApiToken, tokenHash } from "@/lib/api-tokens";
import { ownerId } from "@/lib/token-owner";

export const runtime = "nodejs";

export async function GET() {
  if (!(await ownerId())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const tokens = await sql`
    select id, label, scope, created_by, created_at, last_used_at, revoked_at
    from api_tokens order by created_at desc
  `;
  return NextResponse.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const createdBy = await ownerId();
  if (!createdBy) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const scope = body?.scope;
  if (!label || label.length > 100 || (scope !== "read_only" && scope !== "read_write")) {
    return NextResponse.json({ error: "label and scope are required" }, { status: 400 });
  }
  const token = newApiToken();
  const rows = (await sql`
    insert into api_tokens (token_hash, label, scope, created_by)
    values (${await tokenHash(token)}, ${label}, ${scope}, ${createdBy})
    returning id, label, scope, created_by, created_at, last_used_at, revoked_at
  `) as Record<string, unknown>[];
  return NextResponse.json({ ...rows[0], token }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
