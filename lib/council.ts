// DB helpers for the fact-check council API. The SQL client is injected so the
// routes can be tested with a fake `sql` (see tests/council-routes.test.cjs),
// while production passes the shared client from lib/db.ts. All values go
// through tagged-template parameters — no string-built SQL.

import { buildCouncilPrompt, type FactCheck } from "@/lib/fact-check";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type Prompt = { system: string; user: string };

export interface CouncilPendingRow {
  episode_id: string;
  run_id: string;
  show_id: string;
  title: string;
  script: string;
  briefing_snapshot: string | null;
  briefing_docs?: string | null;
}

export interface CouncilPendingItem extends CouncilPendingRow {
  prompts: { quickdraw: Prompt; scholar: Prompt; qwen: Prompt };
}

/**
 * Pending = opted-in show owned by the caller, whose latest run has an episode,
 * a non-empty script and no council verdict yet. `fact_check.agent_notes` being
 * absent/short is not enough: a clean council pass also clears the queue.
 * Oldest first, at most ten, and prompts are built server-side so the leader
 * script and the manual buttons use exactly the same text.
 */
export async function listPendingCouncil(
  sql: SqlFn,
  userId: string,
  limit = 10,
): Promise<CouncilPendingItem[]> {
  const rows = (await sql`
    with latest as (
      select distinct on (r.episode_id)
        r.episode_id, r.id as run_id, r.show_id, r.briefing_snapshot, r.fact_check, r.started_at
      from runs r
      where r.episode_id is not null
      order by r.episode_id, r.started_at desc, r.id desc
    )
    select e.id as episode_id, l.run_id, l.show_id, e.title, e.script, l.briefing_snapshot,
           coalesce(b.docs, '') as briefing_docs
    from latest l
    join episodes e on e.id = l.episode_id
    join shows s on s.id = l.show_id
    left join lateral (
      select string_agg('### ' || filename || E'\n' || content_md, E'\n\n' order by uploaded_at) as docs
      from show_briefings where show_id = l.show_id and is_active = true
    ) b on true
    where s.user_id = ${userId}
      and s.fact_check_council = true
      and nullif(btrim(coalesce(e.script, '')), '') is not null
      and (l.fact_check is null or l.fact_check->'council'->>'verdict' is null)
    order by l.started_at asc, l.run_id asc
    limit ${limit}
  `) as CouncilPendingRow[];

  return rows.map((row) => ({
    episode_id: row.episode_id,
    run_id: row.run_id,
    show_id: row.show_id,
    title: row.title,
    script: row.script,
    briefing_snapshot: row.briefing_snapshot,
    briefing_docs: row.briefing_docs ?? null,
    prompts: {
      quickdraw: buildCouncilPrompt("quickdraw", row.script || "", [row.briefing_snapshot, row.briefing_docs].filter(Boolean).join("\n\n")),
      scholar: buildCouncilPrompt("scholar", row.script || "", [row.briefing_snapshot, row.briefing_docs].filter(Boolean).join("\n\n")),
      // Q5 reserved voter: always present, harmless if the leader ignores it.
      qwen: buildCouncilPrompt("qwen", row.script || "", [row.briefing_snapshot, row.briefing_docs].filter(Boolean).join("\n\n")),
    },
  }));
}

export interface CouncilEpisode {
  episode_id: string;
  show_id: string;
  title: string;
  status: string;
  audio_url: string | null;
  fact_check_council: boolean;
  run_id: string;
  fact_check: unknown;
}

/** Ownership check and run load in one parameterized query. A null result means
 * "not found or not yours" — the route reports both as 404. Runs have no
 * created_at column, so "latest" is started_at desc (id breaks ties). */
export async function findCouncilEpisode(
  sql: SqlFn,
  episodeId: string,
  userId: string,
): Promise<CouncilEpisode | null> {
  const rows = (await sql`
    select e.id as episode_id, e.show_id, e.title, e.status, e.audio_url,
           s.fact_check_council, r.id as run_id, r.fact_check
    from episodes e
    join shows s on s.id = e.show_id
    join lateral (
      select id, fact_check from runs
      where episode_id = e.id
      order by started_at desc, id desc
      limit 1
    ) r on true
    where e.id = ${episodeId} and s.user_id = ${userId}
    limit 1
  `) as CouncilEpisode[];
  return rows[0] ?? null;
}

/** Neon returns jsonb as an object, but older rows (or test doubles) may hold
 * a JSON string. Anything else is treated as "no automatic notes yet". */
export function parseStoredFactCheck(value: unknown): FactCheck | null {
  if (!value) return null;
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const factCheck = parsed as FactCheck;
  return Array.isArray(factCheck.notes) ? factCheck : null;
}

/** `merged` already preserves layer-1 notes/model/checked_at via
 * mergeCouncilResult, so writing the whole jsonb value cannot clobber them. */
export async function saveCouncilFactCheck(
  sql: SqlFn,
  runId: string,
  showId: string,
  merged: FactCheck,
): Promise<void> {
  await sql`
    update runs set fact_check = ${JSON.stringify(merged)}::jsonb
    where id = ${runId} and show_id = ${showId}
  `;
}

export interface PublishInput {
  episodeId: string;
  showId: string;
  status: string;
  audioUrl: string | null;
  optedIn: boolean;
  verdict: "pass" | "fail";
}

/** A council pass publishes only when the show opted in and the episode is a
 * draft with finished audio. Failures and manual owner publishes stay as-is. */
export async function publishIfReady(sql: SqlFn, input: PublishInput): Promise<boolean> {
  if (
    input.verdict !== "pass" ||
    input.optedIn !== true ||
    input.status !== "draft" ||
    !input.audioUrl
  ) {
    return false;
  }
  const rows = (await sql`
    update episodes
    set status = 'published', published_at = now()
    where id = ${input.episodeId} and show_id = ${input.showId}
      and status = 'draft' and audio_url is not null
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}
