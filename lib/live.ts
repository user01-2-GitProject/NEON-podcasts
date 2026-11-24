// Live podcast sessions that members and their agents can join
// (docs/live-podcast-design.md). Every participation write is scoped to the
// caller resolved from auth (currentCaller); request bodies never supply a
// user id, token id, participant id or kind.
import type { Caller } from "@/lib/current-user";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type SessionStatus = "scheduled" | "live" | "ended";
export type ParticipantKind = "human" | "agent";
export type ParticipantRole = "host" | "guest" | "listener";
export type TurnKind = "speech" | "chat";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TITLE_MAX = 200;
export const DISPLAY_NAME_MAX = 40;
export const TURN_TEXT_MAX = 4000;
export const TURNS_PAGE = 200;
export const TURN_COOLDOWN_SECONDS = 3;
export const AWAY_AFTER_SECONDS = 60;

export type LiveSession = {
  id: string;
  show_id: string | null;
  title: string;
  status: SessionStatus;
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LiveParticipant = {
  id: string;
  display_name: string;
  kind: ParticipantKind;
  role: ParticipantRole;
  muted: boolean;
  away: boolean;
};

export type LiveTurn = {
  seq: number;
  kind: "speech" | "chat" | "system";
  text: string;
  created_at: string;
  participant: { id: string; display_name: string; kind: ParticipantKind; role: ParticipantRole };
};

// Errors a route can return verbatim.
export class LiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// An agent is a token whose label starts with "agent:" (minted by POST /api/me/tokens).
// Browser sessions and phone tokens ("mobile:<email>") are humans.
export function participantKind(tokenLabel: string | null): ParticipantKind {
  return tokenLabel?.startsWith("agent:") ? "agent" : "human";
}

export function isLiveOwner(caller: Caller): boolean {
  return caller.role === "owner" && caller.ownerApproved;
}

// Request bodies are untrusted JSON: read fields from a plain record.
function fields(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" ? Object.fromEntries(Object.entries(body)) : {};
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new LiveError(`${field} is required`, 400);
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) throw new LiveError(`${field} is required`, 400);
  if (trimmed.length > max) throw new LiveError(`${field} is limited to ${max} characters`, 400);
  return trimmed;
}

export function checkNewSession(body: unknown): { title: string; showId: string | null; maxParticipants: number } {
  const input = fields(body);
  const title = text(input.title, "title", TITLE_MAX);
  const showId = input.show_id == null || input.show_id === "" ? null : input.show_id;
  if (showId !== null && (typeof showId !== "string" || !UUID_RE.test(showId))) throw new LiveError("invalid show_id", 400);
  const max = input.max_participants == null ? 12 : Number(input.max_participants);
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new LiveError("max_participants must be 1-100", 400);
  return { title, showId, maxParticipants: max };
}

export function checkTurn(body: unknown): { kind: TurnKind; text: string } {
  const input = fields(body);
  if (input.kind !== "speech" && input.kind !== "chat") throw new LiveError("kind must be 'speech' or 'chat'", 400);
  if (typeof input.text !== "string" || !input.text.trim()) throw new LiveError("text is required", 400);
  const value = input.text.trim();
  if (value.length > TURN_TEXT_MAX) throw new LiveError(`text is limited to ${TURN_TEXT_MAX} characters`, 400);
  return { kind: input.kind, text: value };
}

export function checkDisplayName(body: unknown): string {
  return text(fields(body).display_name, "display_name", DISPLAY_NAME_MAX);
}

export function checkParticipantPatch(body: unknown): { role?: ParticipantRole; muted?: boolean; removed?: boolean } {
  const input = fields(body);
  const patch: { role?: ParticipantRole; muted?: boolean; removed?: boolean } = {};
  if (input.role !== undefined) {
    if (input.role !== "host" && input.role !== "guest" && input.role !== "listener") throw new LiveError("invalid role", 400);
    patch.role = input.role;
  }
  for (const key of ["muted", "removed"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new LiveError(`${key} must be a boolean`, 400);
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) throw new LiveError("nothing to update", 400);
  return patch;
}

export async function listSessions(db: SqlFn): Promise<LiveSession[]> {
  return (await db`
    select id, show_id, title, status, max_participants, started_at, ended_at, created_at
    from live_sessions
    where status in ('scheduled', 'live')
    order by (status = 'live') desc, created_at desc
    limit 100
  `) as LiveSession[];
}

export async function getSession(db: SqlFn, sessionId: string): Promise<LiveSession | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const rows = (await db`
    select id, show_id, title, status, max_participants, started_at, ended_at, created_at
    from live_sessions where id = ${sessionId} limit 1
  `) as LiveSession[];
  return rows[0] ?? null;
}

export async function createSession(
  db: SqlFn,
  caller: Caller,
  input: { title: string; showId: string | null; maxParticipants: number },
): Promise<LiveSession> {
  const rows = (await db`
    insert into live_sessions (title, show_id, max_participants, created_by)
    values (${input.title}, ${input.showId}::uuid, ${input.maxParticipants}, ${caller.userId})
    returning id, show_id, title, status, max_participants, started_at, ended_at, created_at
  `) as LiveSession[];
  return rows[0];
}

// scheduled → live → ended; ending is final and freezes all writes.
export async function setSessionStatus(db: SqlFn, sessionId: string, status: unknown): Promise<LiveSession> {
  if (status !== "live" && status !== "ended") throw new LiveError("status must be 'live' or 'ended'", 400);
  const rows = (await db`
    update live_sessions set
      status = ${status},
      started_at = case when ${status} = 'live' then now() else started_at end,
      ended_at = case when ${status} = 'ended' then now() else ended_at end
    where id = ${sessionId}
      and ((${status} = 'live' and status = 'scheduled') or (${status} = 'ended' and status in ('scheduled', 'live')))
    returning id, show_id, title, status, max_participants, started_at, ended_at, created_at
  `) as LiveSession[];
  if (rows[0]) return rows[0];
  if (!(await getSession(db, sessionId))) throw new LiveError("session not found", 404);
  throw new LiveError(`session cannot go ${status} from its current status`, 409);
}

// A token-joined participant whose token was revoked or deleted has left;
// stamp left_at so presence and capacity agree. Turns are never touched.
export async function markDepartedTokens(db: SqlFn, sessionId: string): Promise<void> {
  await db`
    update live_participants p set left_at = now()
    where p.session_id = ${sessionId} and p.left_at is null and p.via = 'token'
      and (p.token_id is null or exists (
        select 1 from api_tokens t where t.id = p.token_id and t.revoked_at is not null
      ))
  `;
}

export async function listParticipants(db: SqlFn, sessionId: string): Promise<LiveParticipant[]> {
  await markDepartedTokens(db, sessionId);
  const rows = (await db`
    select id, display_name, kind, role, muted,
           last_seen_at < now() - make_interval(secs => ${AWAY_AFTER_SECONDS}) as away
    from live_participants
    where session_id = ${sessionId} and left_at is null and not removed
    order by (role = 'host') desc, (role = 'guest') desc, joined_at asc
  `) as LiveParticipant[];
  return rows.map((row) => ({ ...row, away: row.away === true }));
}

export async function listTurns(db: SqlFn, sessionId: string, after: unknown): Promise<LiveTurn[]> {
  const afterSeq = after == null || after === "" ? 0 : Number(after);
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new LiveError("after must be a non-negative integer", 400);
  const rows = (await db`
    select t.seq, t.kind, t.text, t.created_at,
           p.id as participant_id, p.display_name, p.kind as participant_kind, p.role
    from live_turns t
    join live_participants p on p.id = t.participant_id
    where t.session_id = ${sessionId} and t.seq > ${afterSeq}
    order by t.seq asc
    limit ${TURNS_PAGE}
  `) as {
    seq: string | number;
    kind: LiveTurn["kind"];
    text: string;
    created_at: string | Date;
    participant_id: string;
    display_name: string;
    participant_kind: ParticipantKind;
    role: ParticipantRole;
  }[];
  return rows.map((row) => ({
    seq: Number(row.seq),
    kind: row.kind,
    text: row.text,
    created_at: new Date(row.created_at).toISOString(),
    participant: { id: row.participant_id, display_name: row.display_name, kind: row.participant_kind, role: row.role },
  }));
}

// Joins (or rejoins) the caller. Browser callers are keyed by user, token
// callers by token, so one member can run several agents side by side. The
// session creator joins as host; everyone else as a listener.
export async function joinSession(
  db: SqlFn,
  caller: Caller,
  sessionId: string,
  displayName: string,
): Promise<LiveParticipant> {
  await markDepartedTokens(db, sessionId);
  const sessions = (await db`
    select s.status, s.max_participants, s.created_by,
           (select count(*) from live_participants p
             where p.session_id = s.id and p.left_at is null and not p.removed
               and not (p.user_id is not distinct from ${caller.userId}::uuid
                        and p.token_id is not distinct from ${caller.tokenId}::uuid
                        and p.via = ${caller.tokenId ? "token" : "browser"})) as others
    from live_sessions s where s.id = ${sessionId} limit 1
  `) as { status: SessionStatus; max_participants: number; created_by: string | null; others: string | number }[];
  const session = sessions[0];
  if (!session) throw new LiveError("session not found", 404);
  if (session.status !== "live") throw new LiveError("session is not live", 409);
  if (Number(session.others) >= session.max_participants) throw new LiveError("session is full", 409);

  const kind = participantKind(caller.tokenLabel);
  const role: ParticipantRole = session.created_by === caller.userId ? "host" : "listener";
  const rows = (caller.tokenId
    ? await db`
        insert into live_participants (session_id, user_id, token_id, via, kind, role, display_name)
        values (${sessionId}, ${caller.userId}, ${caller.tokenId}, 'token', ${kind}, ${role}, ${displayName})
        on conflict (session_id, token_id) where token_id is not null do update set
          display_name = excluded.display_name, left_at = null, last_seen_at = now()
        where not live_participants.removed
        returning id, display_name, kind, role, muted, false as away
      `
    : await db`
        insert into live_participants (session_id, user_id, token_id, via, kind, role, display_name)
        values (${sessionId}, ${caller.userId}, null, 'browser', ${kind}, ${role}, ${displayName})
        on conflict (session_id, user_id) where via = 'browser' do update set
          display_name = excluded.display_name, left_at = null, last_seen_at = now()
        where not live_participants.removed
        returning id, display_name, kind, role, muted, false as away
      `) as LiveParticipant[];
  if (!rows[0]) throw new LiveError("you were removed from this session", 403);
  return rows[0];
}

// The caller's own participant row: same user, same token (or none), same entry path.
export async function heartbeat(db: SqlFn, caller: Caller, sessionId: string): Promise<boolean> {
  const rows = (await db`
    update live_participants set last_seen_at = now()
    where session_id = ${sessionId} and user_id = ${caller.userId}
      and token_id is not distinct from ${caller.tokenId}::uuid and via = ${caller.tokenId ? "token" : "browser"}
      and left_at is null and not removed
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function leaveSession(db: SqlFn, caller: Caller, sessionId: string): Promise<boolean> {
  const rows = (await db`
    update live_participants set left_at = now()
    where session_id = ${sessionId} and user_id = ${caller.userId}
      and token_id is not distinct from ${caller.tokenId}::uuid and via = ${caller.tokenId ? "token" : "browser"}
      and left_at is null
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

// Posts a speech or chat turn as the caller's own participant. Speech needs the
// stage (host or guest) and not being muted; anyone present may chat.
export async function postTurn(
  db: SqlFn,
  caller: Caller,
  sessionId: string,
  turn: { kind: TurnKind; text: string },
): Promise<{ seq: number }> {
  const rows = (await db`
    select p.id, p.role, p.muted, p.removed, p.left_at, s.status,
           exists (
             select 1 from live_turns t
             where t.participant_id = p.id and t.created_at > now() - make_interval(secs => ${TURN_COOLDOWN_SECONDS})
           ) as cooling_down
    from live_participants p
    join live_sessions s on s.id = p.session_id
    where p.session_id = ${sessionId} and p.user_id = ${caller.userId}
      and p.token_id is not distinct from ${caller.tokenId}::uuid and p.via = ${caller.tokenId ? "token" : "browser"}
    limit 1
  `) as {
    id: string;
    role: ParticipantRole;
    muted: boolean;
    removed: boolean;
    left_at: string | null;
    status: SessionStatus;
    cooling_down: boolean;
  }[];
  const me = rows[0];
  if (!me || me.left_at || me.removed) throw new LiveError("join the session first", 403);
  if (me.status !== "live") throw new LiveError("session is not live", 409);
  if (turn.kind === "speech" && me.role === "listener") throw new LiveError("only the host and guests can speak", 403);
  if (turn.kind === "speech" && me.muted) throw new LiveError("you are muted", 403);
  if (me.cooling_down) throw new LiveError(`wait ${TURN_COOLDOWN_SECONDS} seconds between turns`, 429);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const inserted = (await db`
        insert into live_turns (session_id, participant_id, seq, kind, text)
        select ${sessionId}, ${me.id}, coalesce(max(seq), 0) + 1, ${turn.kind}, ${turn.text}
        from live_turns where session_id = ${sessionId}
        returning seq
      `) as { seq: string | number }[];
      return { seq: Number(inserted[0].seq) };
    } catch (err) {
      // Two turns raced for the same seq: retry once with the next number.
      if (attempt === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

// Owner controls: promote to the stage, mute, remove.
export async function updateParticipant(
  db: SqlFn,
  sessionId: string,
  participantId: string,
  patch: { role?: ParticipantRole; muted?: boolean; removed?: boolean },
): Promise<LiveParticipant> {
  if (!UUID_RE.test(participantId)) throw new LiveError("participant not found", 404);
  const rows = (await db`
    update live_participants set
      role = coalesce(${patch.role ?? null}, role),
      muted = coalesce(${patch.muted ?? null}::boolean, muted),
      removed = coalesce(${patch.removed ?? null}::boolean, removed)
    where id = ${participantId} and session_id = ${sessionId}
    returning id, display_name, kind, role, muted,
              last_seen_at < now() - make_interval(secs => ${AWAY_AFTER_SECONDS}) as away
  `) as LiveParticipant[];
  if (!rows[0]) throw new LiveError("participant not found", 404);
  return { ...rows[0], away: rows[0].away === true };
}
