import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { sql } from "@/lib/db";
import { bearerForbiddenPath, bearerToken, bearerRequestAllowed, isSelfServicePath, tokenHash, type ApiTokenScope } from "@/lib/api-tokens";

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
    if (bearerForbiddenPath(pathname, req.method)) {
      return NextResponse.json({ error: "session required" }, { status: 403 });
    }
    const raw = bearerToken(authorization);
    if (!raw) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      const rows = (await sql`
        update api_tokens t set last_used_at = now()
        from users u
        where t.token_hash = ${await tokenHash(raw)} and t.revoked_at is null and u.id = t.created_by
        returning t.scope as scope, u.role as role, u.owner_approved as owner_approved
      `) as { scope: ApiTokenScope; role: string; owner_approved: boolean }[];
      const row = rows[0];
      if (!row) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      if (
        !bearerRequestAllowed({
          scope: row.scope,
          role: row.role,
          ownerApproved: row.owner_approved,
          method: req.method,
          pathname,
        })
      ) {
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
    loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  // Any signed-in user (member or owner) may manage their own subscriptions
  // and their own devices/tokens.
  if (isSelfServicePath(pathname)) {
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
