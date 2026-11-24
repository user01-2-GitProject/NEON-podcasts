import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller, type Caller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { LiveError, UUID_RE, isLiveOwner } from "@/lib/live";

// Shared plumbing for /api/live/* route handlers: resolve the caller from the
// cookie session or bearer token, and turn LiveError into a JSON response.
export async function liveRoute(
  req: Request,
  opts: { sessionId?: string; ownerOnly?: boolean },
  handler: (caller: Caller) => Promise<Response>,
): Promise<Response> {
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Middleware already gates owner routes; this keeps the handler safe on its own.
  if (opts.ownerOnly && !isLiveOwner(caller)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (opts.sessionId !== undefined && !UUID_RE.test(opts.sessionId)) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  try {
    return await handler(caller);
  } catch (err) {
    if (err instanceof LiveError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
