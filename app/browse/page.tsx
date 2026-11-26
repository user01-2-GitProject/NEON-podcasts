import Link from "next/link";
import { auth } from "@/auth";
import FollowButton from "@/components/FollowButton";
import OfficialBadge from "@/components/OfficialBadge";
import { EXAMPLE_SHOWS, isExampleShow } from "@/lib/example-shows";
import { sql } from "@/lib/db";
import { listFollows, subscriberEmail } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrowseShow = {
  id: string;
  title: string;
  description: string;
  rss_token: string;
  is_official: boolean;
  published_count: string;
  latest_at: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BrowsePage() {
  const email = subscriberEmail(await auth());
  let shows: BrowseShow[] = [];
  let followed: string[] = [];
  let dbError: string | null = null;
  try {
    shows = (await sql`
      select s.id, s.title, s.description, s.rss_token, coalesce(s.is_official, false) as is_official,
        count(e.*) filter (where e.status = 'published') as published_count,
        max(e.published_at) as latest_at
      from shows s
      left join episodes e on e.show_id = s.id
      where s.is_active
      group by s.id
      having count(e.*) filter (where e.status = 'published') > 0
      order by case s.id
        when ${EXAMPLE_SHOWS[0].id} then 0
        when ${EXAMPLE_SHOWS[1].id} then 1
        else 2
      end, latest_at desc nulls last
    `) as BrowseShow[];
    followed = email ? await listFollows(sql, email) : [];
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <header className="topbar">
        <h1>
          <Link href="/"><span className="brand">NEON</span> Podcasts</Link>
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/browse" className="btn secondary">Browse</Link>
          <Link href="/subscriptions" className="btn secondary">Following</Link>
        </div>
      </header>

      <div className="container">
        <div className="panel">
          <h2>Browse shows</h2>
          {dbError ? (
            <p className="error">{dbError}</p>
          ) : shows.length === 0 ? (
            <p className="muted">No shows have published episodes yet.</p>
          ) : (
            shows.map((show) => (
              <div className="list-item" key={show.id}>
                <div>
                  <h2>
                    {show.is_official ? <OfficialBadge /> : null}
                    {show.title}
                    {isExampleShow(show.id) ? <span className="tag example">Example</span> : null}
                  </h2>
                  <p className="muted">{show.description || "No description."}</p>
                  <p className="muted">
                    {Number(show.published_count)} episodes · {formatDate(show.latest_at)}
                  </p>
                  <Link href={`/listen/${show.rss_token}`}>Listen</Link>
                </div>
                <FollowButton showId={show.id} initialFollowing={followed.includes(show.id)} />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
