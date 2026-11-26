import { API_URL } from "./config";

export type BrowseShow = {
  id: string;
  title: string;
  description: string | null;
  rss_token: string;
  published_count: number;
  latest_at: string | null;
  following: boolean;
  image_url?: string | null;
  // Optional: servers before the NEON-official badge don't send it.
  is_official?: boolean;
};

export type FeedEpisode = {
  id: string;
  title: string;
  published_at: string | null;
  show_id: string;
  show_title: string;
  rss_token: string;
  audio_url: string | null;
  // Show artwork (lock-screen art). Optional: older servers and episodes saved
  // in the downloads index before this field existed don't carry it.
  show_image_url?: string | null;
  // Optional for the same reason: older servers and saved downloads lack it.
  show_is_official?: boolean;
};

// Live API shapes mirror lib/live.ts on the server (snake_case on the wire).
export type LiveSession = {
  id: string;
  show_id: string | null;
  title: string;
  status: "scheduled" | "live" | "ended";
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LiveParticipant = {
  id: string;
  display_name: string;
  kind: "human" | "agent";
  role: "host" | "guest" | "listener";
  muted: boolean;
  away: boolean;
};

export type LiveTurn = {
  seq: number;
  kind: "speech" | "chat" | "system";
  text: string;
  created_at: string;
  participant: { id: string; display_name: string; kind: "human" | "agent"; role: "host" | "guest" | "listener" };
};

export type LivePostKind = "speech" | "chat";

export class UnauthorizedError extends Error {}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) throw new UnauthorizedError("Session expired");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${API_URL}${pathOrUrl}`;
}

export const api = {
  browse: (token: string) => request<{ shows: BrowseShow[] }>(token, "/api/browse").then((r) => r.shows),
  following: (token: string) => request<{ episodes: FeedEpisode[] }>(token, "/api/following").then((r) => r.episodes),
  follow: (token: string, showId: string) =>
    request<{ ok: true }>(token, "/api/subscriptions", { method: "POST", body: JSON.stringify({ show_id: showId }) }),
  unfollow: (token: string, showId: string) =>
    request<{ ok: true }>(token, `/api/subscriptions/${encodeURIComponent(showId)}`, { method: "DELETE" }),

  // Live sessions. All calls reuse the app's per-user bearer token; joins and
  // turns are self-service, so the server derives the caller from the token.
  listLiveSessions: (token: string) =>
    request<{ sessions: LiveSession[] }>(token, "/api/live/sessions").then((r) => r.sessions),
  getLiveSession: (token: string, sessionId: string) =>
    request<{ session: LiveSession; participants: LiveParticipant[] }>(
      token,
      `/api/live/${encodeURIComponent(sessionId)}`,
    ),
  joinLive: (token: string, sessionId: string, displayName: string) =>
    request<{ participant: LiveParticipant }>(token, `/api/live/${encodeURIComponent(sessionId)}/join`, {
      method: "POST",
      body: JSON.stringify({ display_name: displayName }),
    }).then((r) => r.participant),
  leaveLive: (token: string, sessionId: string) =>
    request<{ ok: true }>(token, `/api/live/${encodeURIComponent(sessionId)}/leave`, { method: "POST" }),
  getTurns: (token: string, sessionId: string, after: number) =>
    request<{ turns: LiveTurn[] }>(
      token,
      `/api/live/${encodeURIComponent(sessionId)}/turns?after=${encodeURIComponent(String(after))}`,
    ).then((r) => r.turns),
  postTurn: (token: string, sessionId: string, kind: LivePostKind, text: string) =>
    request<{ seq: number }>(token, `/api/live/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: JSON.stringify({ kind, text }),
    }).then((r) => r.seq),
  heartbeatLive: (token: string, sessionId: string) =>
    request<{ ok: true; away_after_seconds: number }>(
      token,
      `/api/live/${encodeURIComponent(sessionId)}/heartbeat`,
      { method: "POST" },
    ),
};

export type ShowDetail = {
  show: { id: string; title: string; description: string | null; rss_token: string; image_url?: string | null; is_official?: boolean };
  episodes: FeedEpisode[];
};

export const showByToken = (token: string, rssToken: string) =>
  request<ShowDetail>(token, `/api/browse/${encodeURIComponent(rssToken)}`);
