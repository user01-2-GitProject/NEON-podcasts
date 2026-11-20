import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const password = form?.get("password");
  const next = (form?.get("next") as string) || "/";

  if (typeof password !== "string" || !checkPassword(password)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  const token = await createSessionToken();
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
