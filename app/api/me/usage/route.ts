import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { currentCaller } from "@/lib/current-user";
import { sql } from "@/lib/db";
import { getLimits, getUsage } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's generation usage over the last 24 hours and their daily caps
// (null for owners, who are unlimited). A read, so any valid token may call it.
export async function GET(req: Request) {
  const caller = await currentCaller({ session: await auth(), authHeader: req.headers.get("authorization"), db: sql });
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isOwner = caller.role === "owner" && caller.ownerApproved;
  const [usage, limits] = await Promise.all([getUsage(sql, caller.userId), isOwner ? null : getLimits(sql)]);
  return NextResponse.json(
    {
      episodes_today: usage.episodes,
      cost_cents_today: usage.costCents,
      episode_limit: limits?.episodesPerDay ?? null,
      cost_limit: limits?.costCentsPerDay ?? null,
      role: isOwner ? "owner" : "member",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
