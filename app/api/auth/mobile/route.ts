import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { allowedGoogleAudiences, exchangeGoogleIdToken, fetchGoogleTokenInfo } from "@/lib/mobile-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  const result = await exchangeGoogleIdToken({
    idToken,
    allowedAudiences: allowedGoogleAudiences(),
    db: sql,
    verify: (t) => fetchGoogleTokenInfo(t),
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
