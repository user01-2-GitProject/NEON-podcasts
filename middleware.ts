import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { sql } from "@/lib/db";
import { bearerToken, scopeAllows, tokenHash, type ApiTokenScope } from "@/lib/api-tokens";

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/cron", "/feed", "/listen", "/_next", "/favicon.ico"];
// Decode the v5 session with Auth.js while keeping Node-only password code out of Edge.
const { auth } = NextAuth(authConfig);

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.method === "GET" && /^\/api\/episodes\/[^/]+\/audio$/.test(pathname) && req.nextUrl.searchParams.has("feed")) {
    return NextResponse.next();
  }

  const authorization = req.headers.get("authorization");
  if (pathname.startsWith("/api/") && authorization) {
    if (pathname === "/api/tokens" || pathname.startsWith("/api/tokens/")) {
      return NextResponse.json({ error: "session required" }, { status: 403 });
    }
    const raw = bearerToken(authorization);
    if (!raw) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      const rows = (await sql`
        update api_tokens set last_used_at = now()
        where token_hash = ${await tokenHash(raw)} and revoked_at is null
        returning scope
      `) as { scope: ApiTokenScope }[];
      if (!rows[0]) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      if (!scopeAllows(rows[0].scope, req.method)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.next();
    } catch {
      return NextResponse.json({ error: "token validation unavailable" }, { status: 503 });
    }
  }

  const email = req.auth?.user?.email;
  if (!email) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  // Any signed-in user (member or owner) may manage their own subscriptions.
  if (pathname === "/api/subscriptions" || pathname.startsWith("/api/subscriptions/")) {
    return NextResponse.next();
  }
  const allowedOwner = (req.auth?.user as { role?: string } | undefined)?.role === "owner" && (process.env.OWNER_EMAILS || "")
    .split(",").some((owner) => owner.trim().toLowerCase() === email.toLowerCase());
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !allowedOwner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
