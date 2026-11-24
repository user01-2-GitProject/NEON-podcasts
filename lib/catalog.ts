// JSON catalogue for the native app (Phase 3b). Same data as the /browse and
// /subscriptions pages, plus stream URLs the app can play without a cookie.

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type BrowseShow = {
  id: string;
  title: string;
  description: string | null;
  rss_token: string;
  published_count: number;
  latest_at: string | null;
  following: boolean;
  image_url: string | null;
};

export type FeedEpisode = {
  id: string;
  title: string;
  published_at: string | null;
  show_id: string;
  show_title: string;
  rss_token: string;
  audio_url: string | null;
  // The show's artwork, for players' lock-screen art.
  show_image_url: string | null;
};

// Audio stored behind our own stream route is public only with the show's
// rss_token (?feed=), the same capability /feed and /listen use. Absolute
// CDN URLs pass through untouched.
export function publicAudioPath(audioUrl: string | null, rssToken: string): string | null {
  if (!audioUrl) return null;
  try {
    const url = new URL(audioUrl, "http://app.local");
    if (!/^\/api\/episodes\/[^/]+\/audio$/.test(url.pathname)) return audioUrl;
    url.searchParams.set("feed", rssToken);
    return audioUrl.startsWith("/") ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return audioUrl;
  }
}

// shows.image_url arrives with migration 009. The catalog reads it through
// to_jsonb(), which yields null while the column doesn't exist yet, so these
// queries work whether the code or the migration ships first.
export async function listBrowse(db: SqlFn, email: string): Promise<BrowseShow[]> {
  const rows = (await db`
    select s.id, s.title, s.description, s.rss_token,
           (select to_jsonb(x) ->> 'image_url' from shows x where x.id = s.id) as image_url,
           count(e.*) filter (where e.status = 'published')::int as published_count,
           max(e.published_at) as latest_at,
           exists (
             select 1 from subscriptions sub
             where sub.show_id = s.id and sub.subscriber_email = ${email}
           ) as following
    from shows s
    left join episodes e on e.show_id = s.id
    group by s.id
    having count(e.*) filter (where e.status = 'published') > 0
    order by latest_at desc nulls last
  `) as BrowseShow[];
  return rows.map((r) => ({ ...r, published_count: Number(r.published_count), following: Boolean(r.following) }));
}

export async function listFollowingFeed(db: SqlFn, email: string, limit = 100): Promise<FeedEpisode[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  const rows = (await db`
    select e.id, e.title, e.published_at, e.audio_url,
           s.id as show_id, s.title as show_title, s.rss_token,
           to_jsonb(s) ->> 'image_url' as show_image_url
    from episodes e
    join shows s on s.id = e.show_id
    join subscriptions sub on sub.show_id = s.id
    where sub.subscriber_email = ${email} and e.status = 'published'
    order by e.published_at desc nulls last, e.created_at desc
    limit ${capped}
  `) as FeedEpisode[];
  return rows.map((r) => ({ ...r, audio_url: publicAudioPath(r.audio_url, r.rss_token) }));
}

export type ShowDetail = {
  show: { id: string; title: string; description: string | null; rss_token: string; image_url: string | null };
  episodes: FeedEpisode[];
};

// One show's published episodes, looked up by its rss_token (the same handle /listen uses).
export async function getShowByToken(db: SqlFn, rssToken: string): Promise<ShowDetail | null> {
  const shows = (await db`
    select id, title, description, rss_token, to_jsonb(shows) ->> 'image_url' as image_url
    from shows where rss_token = ${rssToken} limit 1
  `) as ShowDetail["show"][];
  const show = shows[0];
  if (!show) return null;
  const rows = (await db`
    select e.id, e.title, e.published_at, e.audio_url
    from episodes e
    where e.show_id = ${show.id} and e.status = 'published'
    order by e.published_at desc nulls last, e.created_at desc
    limit 200
  `) as { id: string; title: string; published_at: string | null; audio_url: string | null }[];
  return {
    show,
    episodes: rows.map((r) => ({
      ...r,
      show_id: show.id,
      show_title: show.title,
      rss_token: show.rss_token,
      show_image_url: show.image_url,
      audio_url: publicAudioPath(r.audio_url, show.rss_token),
    })),
  };
}
