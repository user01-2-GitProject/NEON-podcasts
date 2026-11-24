import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEFAULT_LIMITS, getLimits, parseLimitsInput, saveLimits, type Limits } from "@/lib/limits";
import { ownerId } from "@/lib/token-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(limits: Limits) {
  return {
    episodes_per_day: limits.episodesPerDay,
    cost_cents_per_day: limits.costCentsPerDay,
    defaults: { episodes_per_day: DEFAULT_LIMITS.episodesPerDay, cost_cents_per_day: DEFAULT_LIMITS.costCentsPerDay },
  };
}

// Owner-only: the daily generation caps for non-owners (defaults when unset).
export async function GET() {
  if (!(await ownerId())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(view(await getLimits(sql)), { headers: { "Cache-Control": "no-store" } });
}

// Owner-only: { episodes_per_day, cost_cents_per_day }, both non-negative integers.
export async function POST(req: Request) {
  if (!(await ownerId())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = parseLimitsInput(await req.json().catch(() => null));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  await saveLimits(sql, input.limits);
  return NextResponse.json(view(await getLimits(sql)), { headers: { "Cache-Control": "no-store" } });
}
