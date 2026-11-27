import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { listPendingCouncil } from "@/lib/council";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Agent-facing queue: the council leader polls this with a read_write token
// owned by the show owner. currentCaller accepts the same token or a browser
// session; middleware enforces bearer scope before we get here.
export async function GET(req: Request) {
  const caller = await currentCaller({
    session: await auth(),
    authHeader: req.headers.get("authorization"),
    db: sql,
  });
  if (!caller) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const items = await listPendingCouncil(sql, caller.userId);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
