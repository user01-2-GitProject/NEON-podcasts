import Image from "next/image";
import Link from "next/link";
import { cadenceLabel } from "@/lib/cadence";
import OfficialBadge from "@/components/OfficialBadge";
import ShowRail, { episodeCards, showCards } from "@/components/ShowRail";
import ShowSpecForm from "@/components/ShowSpecForm";
import SignOutButton from "@/components/SignOutButton";
import UsageMeter from "@/components/UsageMeter";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { getHomeRails } from "@/lib/home-rails";
import { subscriberEmail } from "@/lib/subscriptions";

import "./home-rails.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  const email = subscriberEmail(session);
  let rails = {
    your_shows: [],
    official: [],
    fresh_episodes: [],
    everything: [],
  } as Awaited<ReturnType<typeof getHomeRails>>;
  let dbError: string | null = null;
  try {
    rails = await getHomeRails(sql, email);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const featured = rails.everything[0];

  return (
    <>
      <header className="topbar">
        <h1><Link href="/"><span className="brand">NEON</span> Podcasts</Link></h1>
        <nav className="home-nav" aria-label="Main navigation">
          <Link href="/live" className="btn secondary">Live</Link>
          <Link href="/browse" className="btn secondary">Browse</Link>
          <Link href="/subscriptions" className="btn secondary">Following</Link>
          {owner ? <Link href="/settings" className="btn secondary">Settings</Link> : null}
          <SignOutButton />
        </nav>
      </header>

      <main className="container home-container">
        <UsageMeter />
        {dbError ? (
          <div className="panel">
            <h2>Database not reachable</h2>
            <p className="muted">Set <code>DATABASE_URL</code> and run the migration (<code>npm run db:migrate</code>).</p>
            <p className="error">{dbError}</p>
          </div>
        ) : null}

        {featured ? (
          <section className="featured-show" aria-labelledby="featured-heading">
            <Image className="featured-art" src={featured.image_url} alt={`${featured.title} cover art`} width={360} height={360} unoptimized priority />
            <div className="featured-copy">
              <p className="eyebrow">Featured podcast</p>
              <h2 id="featured-heading" className="home-show-title">
                <OfficialBadge size={30} label={featured.is_official ? "NEON official" : "Featured podcast"} />
                {featured.title}
              </h2>
              <p className="muted">{cadenceLabel(featured.cadence, featured.air_days)} · ~{featured.target_minutes} min · {featured.episode_count} episode{featured.episode_count === 1 ? "" : "s"}</p>
              <Link href={`/shows/${featured.id}`} className="btn primary">Open show</Link>
            </div>
          </section>
        ) : null}

        <ShowRail
          id="your-shows"
          title="Your shows"
          href="/subscriptions"
          cards={showCards(rails.your_shows)}
          empty={email ? "Follow a show and it will show up here." : "Sign in to see the shows you follow."}
        />
        <ShowRail
          id="official"
          title="NEON Official"
          href="/browse"
          cards={showCards(rails.official)}
          empty="No official shows have published episodes yet."
        />
        <ShowRail
          id="fresh"
          title="Fresh episodes"
          href="/browse"
          cards={episodeCards(rails.fresh_episodes)}
          empty="No episodes published yet."
        />
        <ShowRail
          id="everything"
          title="Browse everything"
          href="/browse"
          cards={showCards(rails.everything)}
          empty="No shows yet. Create your first show to get started."
        />

        {owner ? (
          <section className="panel home-owner-tools">
            <h2>Start a new show</h2>
            <p className="muted">A few questions, one at a time, with "Skip" on everything but the name.</p>
            <p><Link href="/shows/new" className="btn primary">Start the wizard</Link></p>
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Rather fill it all in at once? Use the long form.</summary>
              <ShowSpecForm />
            </details>
          </section>
        ) : null}
      </main>
    </>
  );
}
