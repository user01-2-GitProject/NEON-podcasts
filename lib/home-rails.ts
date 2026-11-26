// One payload for the four Spotify-style shelves on the home page. The page
// reads it straight from the DB; /api/browse?rails=1 exposes the same shape in
// a single HTTP call. Only active shows with published episodes appear, and
// every image goes through artworkPath() so no outside URL reaches the page.

import type { Cadence } from "@/lib/cadence";
import { artworkPath } from "@/lib/cover";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export type RailShow = {
  id: string;
  title: string;
  description: string | null;
  cadence: Cadence;
  air_days: number[] | null;
  target_minutes: number;
  is_official: boolean;
  image_url: string;
  episode_count: number;
  latest_at: string | null;
};

export type RailEpisode = {
  id: string;
  title: string;
  show_id: string;
  show_title: string;
  is_official: boolean;
  image_url: string;
  published_at: string | null;
};

export type HomeRails = {
  your_shows: RailShow[];
  official: RailShow[];
  fresh_episodes: RailEpisode[];
  everything: RailShow[];
};

type ShowRow = Omit<RailShow, "image_url" | "is_official" | "episode_count"> & {
  image_url?: string | null;
  is_official?: boolean | null;
  episode_count?: number | string | null;
};

function asShow(row: ShowRow): RailShow {
  return {
    ...row,
    // artworkPath falls back to the generated cover when image_url is empty.
    image_url: artworkPath({ id: row.id, title: row.title, image_url: row.image_url ?? null }),
    is_official: Boolean(row.is_official),
    episode_count: Number(row.episode_count ?? 0),
  };
}

export async function getHomeRails(db: SqlFn, email: string | null, limits: {
  shows?: number;
  episodes?: number;
} = {}): Promise<HomeRails> {
  const showCap = Math.max(1, Math.min(48, Math.floor(limits.shows ?? 24) || 24));
  const episodeCap = Math.max(1, Math.min(48, Math.floor(limits.episodes ?? 12) || 12));

  const [yourShows, official, fresh, everything] = await Promise.all([
    email
      ? (async () => {
          const rows = (await db`
            select s.id, s.title, s.description, s.cadence, s.air_days, s.target_minutes,
              coalesce(s.is_official, false) as is_official,
              (select to_jsonb(x) ->> 'image_url' from shows x where x.id = s.id) as image_url,
              count(e.*) filter (where e.status = 'published')::int as episode_count,
              max(e.published_at) as latest_at
            from shows s
            left join episodes e on e.show_id = s.id
            where s.is_active
              and exists (
                select 1 from subscriptions sub
                where sub.show_id = s.id and sub.subscriber_email = ${email}
              )
            group by s.id
            having count(e.*) filter (where e.status = 'published') > 0
            order by latest_at desc nulls last, s.title asc
            limit ${showCap}
          `) as ShowRow[];
          return rows.map(asShow);
        })()
      : Promise.resolve([] as RailShow[]),
    (async () => {
      const rows = (await db`
        select s.id, s.title, s.description, s.cadence, s.air_days, s.target_minutes,
          coalesce(s.is_official, false) as is_official,
          (select to_jsonb(x) ->> 'image_url' from shows x where x.id = s.id) as image_url,
          count(e.*) filter (where e.status = 'published')::int as episode_count,
          max(e.published_at) as latest_at
        from shows s
        left join episodes e on e.show_id = s.id
        where s.is_active and coalesce(s.is_official, false)
        group by s.id
        having count(e.*) filter (where e.status = 'published') > 0
        order by latest_at desc nulls last, s.title asc
        limit ${showCap}
      `) as ShowRow[];
      return rows.map(asShow);
    })(),
    (async () => {
      const rows = (await db`
        select e.id, e.title, e.published_at, s.id as show_id, s.title as show_title,
          coalesce(s.is_official, false) as is_official,
          (select to_jsonb(x) ->> 'image_url' from shows x where x.id = s.id) as image_url
        from episodes e
        join shows s on s.id = e.show_id
        where e.status = 'published' and s.is_active
        order by e.published_at desc nulls last, e.created_at desc
        limit ${episodeCap}
      `) as (Omit<RailEpisode, "image_url" | "is_official"> & {
        is_official?: boolean | null;
        image_url?: string | null;
      })[];
      return rows.map((row) => ({
        ...row,
        is_official: Boolean(row.is_official),
        image_url: artworkPath({ id: row.show_id, title: row.show_title, image_url: row.image_url ?? null }),
      }));
    })(),
    (async () => {
      const rows = (await db`
        select s.id, s.title, s.description, s.cadence, s.air_days, s.target_minutes,
          coalesce(s.is_official, false) as is_official,
          (select to_jsonb(x) ->> 'image_url' from shows x where x.id = s.id) as image_url,
          count(e.*) filter (where e.status = 'published')::int as episode_count,
          max(e.published_at) as latest_at
        from shows s
        left join episodes e on e.show_id = s.id
        where s.is_active
        group by s.id
        having count(e.*) filter (where e.status = 'published') > 0
        order by latest_at desc nulls last, s.title asc
        limit ${showCap}
      `) as ShowRow[];
      return rows.map(asShow);
    })(),
  ]);

  return { your_shows: yourShows, official, fresh_episodes: fresh, everything };
}
