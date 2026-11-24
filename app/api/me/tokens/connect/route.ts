import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { newApiToken, tokenHash } from "@/lib/api-tokens";
import { allowedAppRedirect, createMyDeviceToken, withToken } from "@/lib/me-tokens";

export const runtime = "nodejs";

// Browser sign-in for the native app (works in Expo Go, no mobile OAuth client needed):
// the app opens /mobile-connect, the user confirms while signed in with a cookie session,
// and we redirect back to the app's deep link with a fresh per-user token.
// Cookie session only: a bearer token can't mint more tokens.
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const redirect = allowedAppRedirect(form?.get("redirect"));
  if (!redirect) return NextResponse.json({ error: "invalid redirect" }, { status: 400 });
  const rows = (await sql`select id from users where email = ${email} limit 1`) as { id: string }[];
  if (!rows[0]) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = newApiToken();
  await createMyDeviceToken(sql, rows[0].id, email, token, await tokenHash(token));
  return NextResponse.redirect(withToken(redirect, token), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
}
