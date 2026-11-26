import Link from "next/link";
import { auth } from "@/auth";
import OfficialBadge from "@/components/OfficialBadge";
import { sql } from "@/lib/db";
import { subscriberEmail } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FollowedEpisode = {
  id: string;
  title: string;
  published_at: string | null;
  show_title: string;
  show_is_official: boolean;
  rss_token: string;
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

export default async function SubscriptionsPage() {
  const email = subscriberEmail(await auth());
  let episodes: FollowedEpisode[] = [];
  let dbError: string | null = null;
  try {
    if (email) {
      episodes = (await sql`
        select e.id, e.title, e.published_at, s.title as show_title,
          coalesce(s.is_official, false) as show_is_official, s.rss_token
        from episodes e
        join shows s on s.id = e.show_id
        join subscriptions sub on sub.show_id = s.id
        where sub.subscriber_email = ${email} and e.status = 'published'
        order by e.published_at desc nulls last, e.created_at desc
        limit 100
      `) as FollowedEpisode[];
    }
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
          <h2>Following</h2>
          {dbError ? (
            <p className="error">{dbError}</p>
          ) : episodes.length === 0 ? (
            <>
              <p className="muted">You&apos;re not following any shows yet.</p>
              <Link href="/browse" className="btn">Browse shows</Link>
            </>
          ) : (
            episodes.map((episode) => (
              <div className="list-item" key={episode.id}>
                <div>
                  <Link href={`/listen/${episode.rss_token}`} style={{ fontWeight: 600 }}>
                    {episode.title}
                  </Link>
                  <div className="muted">
                    {episode.show_is_official ? <OfficialBadge size={18} /> : null}
                    {episode.show_title} · {formatDate(episode.published_at)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
