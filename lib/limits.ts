// Per-user generation limits (cost guardrails). Owners are unlimited; every
// other user is capped per rolling 24 hours by episodes and by estimated
// LLM cost. Caps live in app_settings so they can change without a deploy.

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export const LIMIT_KEYS = {
  episodesPerDay: "gen_limit_episodes_per_day",
  costCentsPerDay: "gen_limit_cost_cents_per_day",
} as const;

export type Limits = { episodesPerDay: number; costCentsPerDay: number };

// Used when a key is unset or not a non-negative integer.
export const DEFAULT_LIMITS: Limits = { episodesPerDay: 5, costCentsPerDay: 100 };

export type Usage = { episodes: number; costCents: number };

// Whose usage is checked: the user and whether they are an approved owner.
export type LimitSubject = { userId: string; isOwner: boolean };

export type LimitDecision =
  | { allowed: true; unlimited: boolean }
  | { allowed: false; reason: string; limit: "episodes" | "cost" };

function parseCap(raw: string | null | undefined, fallback: number): number {
  if (raw == null || !/^\d+$/.test(raw.trim())) return fallback;
  return Number(raw.trim());
}

export function parseLimits(settings: Record<string, string | null | undefined>): Limits {
  return {
    episodesPerDay: parseCap(settings[LIMIT_KEYS.episodesPerDay], DEFAULT_LIMITS.episodesPerDay),
    costCentsPerDay: parseCap(settings[LIMIT_KEYS.costCentsPerDay], DEFAULT_LIMITS.costCentsPerDay),
  };
}

export async function getLimits(db: SqlFn): Promise<Limits> {
  const rows = (await db`
    select key, value from app_settings
    where key in (${LIMIT_KEYS.episodesPerDay}, ${LIMIT_KEYS.costCentsPerDay})
  `) as { key: string; value: string | null }[];
  return parseLimits(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

// Upper bound for an owner-entered cap: generous, but rules out typos like 1e12.
export const LIMIT_INPUT_MAX = 1_000_000;

function capInput(value: unknown, field: string): { value: number } | { error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { error: `${field} must be a non-negative integer` };
  }
  if (value > LIMIT_INPUT_MAX) return { error: `${field} must be at most ${LIMIT_INPUT_MAX}` };
  return { value };
}

// Validates POST /api/limits { episodes_per_day, cost_cents_per_day }. Both are
// required; 0 is allowed (it blocks non-owner generation entirely).
export function parseLimitsInput(body: unknown): { limits: Limits } | { error: string } {
  const input: Record<string, unknown> =
    body !== null && typeof body === "object" ? Object.fromEntries(Object.entries(body)) : {};
  const episodes = capInput(input.episodes_per_day, "episodes_per_day");
  if ("error" in episodes) return episodes;
  const cost = capInput(input.cost_cents_per_day, "cost_cents_per_day");
  if ("error" in cost) return cost;
  return { limits: { episodesPerDay: episodes.value, costCentsPerDay: cost.value } };
}

// Upserts both caps into app_settings (only these two keys).
export async function saveLimits(db: SqlFn, limits: Limits): Promise<void> {
  await db`
    insert into app_settings (key, value, updated_at)
    values (${LIMIT_KEYS.episodesPerDay}, ${String(limits.episodesPerDay)}, now()),
           (${LIMIT_KEYS.costCentsPerDay}, ${String(limits.costCentsPerDay)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

// Generations in the last 24 hours on shows the user owns. Finished runs and
// ones still in flight both count, so parallel requests can't slip past the
// cap; `excludeRunIds` leaves out runs the caller is about to decide on.
export async function getUsage(db: SqlFn, userId: string, excludeRunIds: string[] = []): Promise<Usage> {
  const rows = (await db`
    select
      count(*) filter (
        where r.status = 'done' or (r.status = 'running' and not (r.id = any(${excludeRunIds}::uuid[])))
      ) as episodes,
      coalesce(sum(r.cost_cents) filter (where r.status = 'done'), 0) as cost_cents
    from runs r
    join shows s on s.id = r.show_id
    where s.user_id = ${userId}
      and r.started_at > now() - interval '24 hours'
  `) as { episodes: string | number; cost_cents: string | number }[];
  return { episodes: Number(rows[0]?.episodes ?? 0), costCents: Number(rows[0]?.cost_cents ?? 0) };
}

export function decideGeneration(opts: { isOwner: boolean; usage: Usage; limits: Limits }): LimitDecision {
  if (opts.isOwner) return { allowed: true, unlimited: true };
  const { usage, limits } = opts;
  if (usage.episodes >= limits.episodesPerDay) {
    return {
      allowed: false,
      limit: "episodes",
      reason: `You've made today's ${limits.episodesPerDay} episodes. More tomorrow, or ask an owner to raise the limit.`,
    };
  }
  if (usage.costCents >= limits.costCentsPerDay) {
    return {
      allowed: false,
      limit: "cost",
      reason: `You've used today's $${(limits.costCentsPerDay / 100).toFixed(2)} episode budget. More tomorrow, or ask an owner to raise the limit.`,
    };
  }
  return { allowed: true, unlimited: false };
}

// The user a show's generation is charged to: its owner (shows.user_id).
// Shows created before ownership was recorded have no owner; only owners could
// create shows then, so they are treated as owner shows (unlimited).
export async function showSubject(db: SqlFn, showId: string): Promise<LimitSubject | null> {
  const rows = (await db`
    select u.id, u.role, u.owner_approved
    from shows s join users u on u.id = s.user_id
    where s.id = ${showId}
    limit 1
  `) as { id: string; role: string; owner_approved: boolean }[];
  const row = rows[0];
  return row ? { userId: row.id, isOwner: row.role === "owner" && row.owner_approved === true } : null;
}

// One check for an on-demand generation.
export async function checkGeneration(db: SqlFn, subject: LimitSubject | null): Promise<LimitDecision> {
  if (!subject || subject.isOwner) return { allowed: true, unlimited: true };
  const [usage, limits] = await Promise.all([getUsage(db, subject.userId), getLimits(db)]);
  return decideGeneration({ isOwner: false, usage, limits });
}

export type ScheduledCandidate = { runId: string; subject: LimitSubject | null };

// Decides a claimed scheduler batch in order. Each user's prior usage is
// counted once (excluding the batch itself, whose runs are already marked
// running), then every approved run in the batch counts toward the next one.
export function planScheduledRuns(
  candidates: ScheduledCandidate[],
  usageByUser: Map<string, Usage>,
  limits: Limits,
): { allowed: string[]; skipped: { runId: string; reason: string }[] } {
  const allowed: string[] = [];
  const skipped: { runId: string; reason: string }[] = [];
  const approvedByUser = new Map<string, number>();
  for (const { runId, subject } of candidates) {
    if (!subject || subject.isOwner) {
      allowed.push(runId);
      continue;
    }
    const prior = usageByUser.get(subject.userId) ?? { episodes: 0, costCents: 0 };
    const approved = approvedByUser.get(subject.userId) ?? 0;
    const decision = decideGeneration({
      isOwner: false,
      usage: { episodes: prior.episodes + approved, costCents: prior.costCents },
      limits,
    });
    if (decision.allowed) {
      allowed.push(runId);
      approvedByUser.set(subject.userId, approved + 1);
    } else {
      skipped.push({ runId, reason: decision.reason });
    }
  }
  return { allowed, skipped };
}

// Looks up who each claimed run is charged to and their usage, then plans the batch.
export async function decideScheduledBatch(
  db: SqlFn,
  claimed: { id: string; show_id: string }[],
): Promise<{ allowed: string[]; skipped: { runId: string; reason: string }[] }> {
  const candidates: ScheduledCandidate[] = [];
  for (const run of claimed) candidates.push({ runId: run.id, subject: await showSubject(db, run.show_id) });
  const limited = [...new Set(candidates.flatMap((c) => (c.subject && !c.subject.isOwner ? [c.subject.userId] : [])))];
  if (limited.length === 0) return { allowed: claimed.map((run) => run.id), skipped: [] };
  const limits = await getLimits(db);
  const claimedIds = claimed.map((run) => run.id);
  const usageByUser = new Map<string, Usage>();
  for (const userId of limited) usageByUser.set(userId, await getUsage(db, userId, claimedIds));
  return planScheduledRuns(candidates, usageByUser, limits);
}

// Records a scheduled run as skipped (not retried) and moves the show to its
// next slot, so the scheduler doesn't keep re-claiming the capped slot.
export async function skipScheduledRun(db: SqlFn, runId: string, reason: string): Promise<void> {
  await db`
    with skipped as (
      update runs set
        status = 'skipped', error = ${reason}, next_attempt_at = null, finished_at = now()
      where id = ${runId} and status = 'running'
      returning show_id, scheduled_for
    )
    update shows set next_run_at = case cadence
      when 'twice_daily' then (((next_run_at at time zone timezone) + interval '12 hours') at time zone timezone)
      when 'daily' then (((next_run_at at time zone timezone) + interval '1 day') at time zone timezone)
      when 'weekdays' then (((next_run_at at time zone timezone) + (case extract(isodow from (next_run_at at time zone timezone)) when 5 then 3 when 6 then 2 else 1 end) * interval '1 day') at time zone timezone)
      when 'twice_weekly' then (((next_run_at at time zone timezone) + (case when extract(isodow from (next_run_at at time zone timezone)) < 4 then 4 - extract(isodow from (next_run_at at time zone timezone)) else 8 - extract(isodow from (next_run_at at time zone timezone)) end) * interval '1 day') at time zone timezone)
      when 'weekly' then (((next_run_at at time zone timezone) + interval '7 days') at time zone timezone)
      when 'days' then (((next_run_at at time zone timezone) + (select min(n) from generate_series(1, 7) n where extract(isodow from (next_run_at at time zone timezone) + n * interval '1 day')::int = any(air_days)) * interval '1 day') at time zone timezone)
      else null
    end
    from skipped
    where shows.id = skipped.show_id and shows.next_run_at = skipped.scheduled_for
  `;
}
