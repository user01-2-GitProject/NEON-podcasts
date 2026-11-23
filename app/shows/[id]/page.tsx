import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import type { Show, Briefing, Episode, Run } from "@/lib/types";
import BriefingsPanel from "@/components/BriefingsPanel";
import GeneratePanel from "@/components/GeneratePanel";
import EpisodesPanel from "@/components/EpisodesPanel";
import DeleteShowButton from "@/components/DeleteShowButton";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  const { id } = await params;

  const shows = (await sql`select * from shows where id = ${id}`) as Show[];
  const show = shows[0];
  if (!show) notFound();

  const briefings = (await sql`
    select * from show_briefings where show_id = ${id} order by uploaded_at desc
  `) as Briefing[];

  const episodes = (await sql`
    select * from episodes where show_id = ${id} order by created_at desc
  `) as Episode[];

  const runs = (await sql`
    select * from runs where show_id = ${id} order by started_at desc limit 10
  `) as Run[];

  const activeBriefings = briefings.filter((b) => b.is_active).length;

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href="/" className="btn secondary">
          ← All shows
        </Link>
      </header>

      <div className="container">
        <div className="panel">
          <h2>{show.title}</h2>
          <p className="muted">{show.description || "No description."}</p>
          <p className="muted">
            {show.cadence} · ~{show.target_minutes} min · timezone {show.timezone}
          </p>
          {owner ? <DeleteShowButton showId={id} showTitle={show.title} /> : null}
        </div>

        <BriefingsPanel showId={id} initialBriefings={briefings} owner={owner} />

        {owner ? <GeneratePanel
          showId={id}
          activeBriefings={activeBriefings}
          narrationMode={show.narration_mode === "external" ? "external" : "auto"}
        /> : null}

        <EpisodesPanel initialEpisodes={episodes} runs={runs} owner={owner} rssToken={show.rss_token} />
      </div>
    </>
  );
}
