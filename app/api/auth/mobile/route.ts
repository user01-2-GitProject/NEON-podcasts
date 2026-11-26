import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { allowedGoogleAudiences, exchangeGoogleIdToken, fetchGoogleTokenInfo } from "@/lib/mobile-auth";

export const runtime = "nodejs";

// 5 sign-in attempts per minute per IP address.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(req: Request) {
  const limited = limiter.hit(clientIp(req));
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many sign-in tries. Please wait a minute and try again." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }
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
