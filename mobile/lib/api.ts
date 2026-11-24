import { API_URL } from "./config";

export type BrowseShow = {
  id: string;
  title: string;
  description: string | null;
  rss_token: string;
  published_count: number;
  latest_at: string | null;
  following: boolean;
};

export type FeedEpisode = {
  id: string;
  title: string;
  published_at: string | null;
  show_id: string;
  show_title: string;
  rss_token: string;
  audio_url: string | null;
};

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
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
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
};

export type ShowDetail = {
  show: { id: string; title: string; description: string | null; rss_token: string };
  episodes: FeedEpisode[];
};

export const showByToken = (token: string, rssToken: string) =>
  request<ShowDetail>(token, `/api/browse/${encodeURIComponent(rssToken)}`);
