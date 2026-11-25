import Link from "next/link";
import { cadenceLabel } from "@/lib/cadence";
import { sql } from "@/lib/db";
import type { Show } from "@/lib/types";
import ShowSpecForm from "@/components/ShowSpecForm";
import SignOutButton from "@/components/SignOutButton";
import UsageMeter from "@/components/UsageMeter";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  let shows: Show[] = [];
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

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/live" className="btn secondary">Live</Link>
          <Link href="/browse" className="btn secondary">Browse</Link>
          <Link href="/subscriptions" className="btn secondary">Following</Link>
          {owner ? <Link href="/settings" className="btn secondary">Settings</Link> : null}
          <SignOutButton />
        </div>
      </header>

      <div className="container">
        <UsageMeter />
        {dbError ? (
          <div className="panel">
            <h2>Database not reachable</h2>
            <p className="muted">
              Set <code>DATABASE_URL</code> and run the migration (<code>npm run db:migrate</code>).
            </p>
            <p className="error">{dbError}</p>
          </div>
        ) : null}

        <div className="panel">
          <h2>Shows</h2>
          {shows.length === 0 ? (
            <p className="muted">No shows yet. Create your first show to get started.</p>
          ) : (
            <div>
              {shows.map((s) => {
                const show = s as Show & { episode_count: number };
                return (
                  <div className="list-item" key={show.id}>
                    <div>
                      <Link href={`/shows/${show.id}`} style={{ fontWeight: 600 }}>
                        {show.title}
                      </Link>
                      <div className="muted">
                        {cadenceLabel(show.cadence)} · ~{show.target_minutes} min ·{" "}
                        {Number(show.episode_count)} episode
                        {Number(show.episode_count) === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Link href={`/shows/${show.id}`} className="btn secondary">
                      Open
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {owner ? <ShowSpecForm /> : null}
      </div>
    </>
  );
}
