import Image from "next/image";
import Link from "next/link";
import { cadenceLabel } from "@/lib/cadence";
import { artworkPath } from "@/lib/cover";
import { sql } from "@/lib/db";
import type { Show } from "@/lib/types";
import OfficialBadge from "@/components/OfficialBadge";
import ShowSpecForm from "@/components/ShowSpecForm";
import SignOutButton from "@/components/SignOutButton";
import UsageMeter from "@/components/UsageMeter";
import { auth } from "@/auth";
import ThemeToggle from "@/components/ThemeToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  let shows: (Show & { episode_count: number })[] = [];
  let dbError: string | null = null;
  try {
    shows = (await sql`
      select s.*,
        (select count(*) from episodes e where e.show_id = s.id) as episode_count
      from shows s order by s.created_at desc
    `) as (Show & { episode_count: number })[];
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const featured = shows[0];

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
        <ThemeToggle />
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
            <Image className="featured-art" src={artworkPath(featured)} alt={`${featured.title} cover art`} width={360} height={360} unoptimized priority />
            <div className="featured-copy">
              <p className="eyebrow">Featured podcast</p>
              <h2 id="featured-heading" className="home-show-title">
                <OfficialBadge size={30} label={featured.is_official ? "NEON official" : "Featured podcast"} />
                {featured.title}
              </h2>
              <p className="muted">{cadenceLabel(featured.cadence, featured.air_days)} · ~{featured.target_minutes} min · {Number(featured.episode_count)} episode{Number(featured.episode_count) === 1 ? "" : "s"}</p>
              <Link href={`/shows/${featured.id}`} className="btn primary">Open show</Link>
            </div>
          </section>
        ) : null}

        <section className="home-section" aria-labelledby="shows-heading">
          <div className="home-section-heading">
            <h2 id="shows-heading">Shows</h2>
            <Link href="/browse">Browse all</Link>
          </div>
          {shows.length === 0 ? (
            <div className="panel"><p className="muted">No shows yet. Create your first show to get started.</p></div>
          ) : (
            <div className="show-grid">
              {shows.map((show) => (
                <Link href={`/shows/${show.id}`} className="show-card" key={show.id}>
                  <Image className="show-card-art" src={artworkPath(show)} alt="" width={320} height={320} unoptimized />
                  <h3 className="home-show-title">
                    {show.is_official ? <OfficialBadge size={22} /> : null}
                    {show.title}
                  </h3>
                  <p className="muted">{cadenceLabel(show.cadence, show.air_days)} · ~{show.target_minutes} min</p>
                </Link>
              ))}
            </div>
          )}
        </section>

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
