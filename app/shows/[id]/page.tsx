import Link from "next/link";
import { artworkPath } from "@/lib/cover";
import { cadenceLabel } from "@/lib/cadence";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import type { Show, Briefing, Episode, Run, Pronunciation } from "@/lib/types";
import BriefingsPanel from "@/components/BriefingsPanel";
import GeneratePanel from "@/components/GeneratePanel";
import SteeringPanel from "@/components/SteeringPanel";
import EpisodesPanel from "@/components/EpisodesPanel";
import DeleteShowButton from "@/components/DeleteShowButton";
import OfficialBadge from "@/components/OfficialBadge";
import OfficialToggle from "@/components/OfficialToggle";
import ShowArtworkForm from "@/components/ShowArtworkForm";
import ShowSpecPanel from "@/components/ShowSpecPanel";
import { auth } from "@/auth";
import ThemeToggle from "@/components/ThemeToggle";

export const runtime = "nodejs";

// "18:00" → "6:00 PM"
function friendlyTime(hhmm: string): string {
  const [h, m = "00"] = hhmm.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return hhmm;
  return `${hour % 12 || 12}:${m.slice(0, 2)} ${hour < 12 ? "AM" : "PM"}`;
}
export const dynamic = "force-dynamic";

export default async function ShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  const { id } = await params;
  const justSaved = (await searchParams).saved === "1";

  const shows = (await sql`select * from shows where id = ${id}`) as Show[];
  const show = shows[0];
  if (!show) notFound();

  const briefings = (await sql`
    select * from show_briefings where show_id = ${id} order by uploaded_at desc
  `) as Briefing[];

  const pronunciations = (await sql`
    select * from show_pronunciations where show_id = ${id} order by created_at asc
  `) as Pronunciation[];

  const episodes = (await sql`
    select * from episodes where show_id = ${id} order by created_at desc
  `) as Episode[];

  const runs = (await sql`
    select * from runs where show_id = ${id} order by started_at desc limit 10
  `) as Run[];

  // QA notes belong to the episode card, which outlives the run-history limit.
  const qaRuns = (await sql`
    select episode_id, script_qa from runs
    where show_id = ${id} and episode_id is not null and script_qa is not null
    order by started_at desc
  `) as Pick<Run, "episode_id" | "script_qa">[];

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
        <ThemeToggle />
      </header>

      <div className="container">
        <div className="panel">
          <img className="show-art" src={artworkPath(show)} alt={`${show.title} artwork`} />
          <h2 className="show-title">{show.is_official ? <OfficialBadge size={32} /> : null}{show.title}</h2>
          <p className="muted">{show.description || "No description."}</p>
          <p className="muted">
            {cadenceLabel(show.cadence, show.air_days)}
            {show.cadence !== "manual" && show.schedule_time ? ` at ${friendlyTime(show.schedule_time)}` : ""} · ~
            {show.target_minutes} min · timezone {show.timezone}
          </p>
          {owner && justSaved ? (
            <div className="notice-safe" role="status">
              <strong>Saved.</strong> Your episodes are all still here. New episodes will use your changes.
            </div>
          ) : null}
          {owner ? (
            <>
              <div className="edit-actions">
                <Link href={`/shows/${id}/edit`} className="btn secondary">
                  ✏️ Edit show
                </Link>
                <Link href={`/shows/${id}/edit#schedule`} className="btn secondary">
                  🗓️ Edit schedule
                </Link>
              </div>
              <p className="muted" style={{ marginTop: 4 }}>
                Editing is safe. You won&apos;t start over, and your episodes stay put.
              </p>
            </>
          ) : null}
          {owner ? <ShowArtworkForm showId={id} initialImageUrl={show.image_url ?? null} /> : null}
          {owner ? (
            <div style={{ margin: "12px 0" }}>
              <OfficialToggle showId={id} initialOfficial={!!show.is_official} />
            </div>
          ) : null}
          {owner ? <DeleteShowButton showId={id} showTitle={show.title} /> : null}
        </div>

        <BriefingsPanel showId={id} initialBriefings={briefings} owner={owner} />

        {/* Make an episode now: always visible to owners; also shown when the
            show's cadence is manual, so a non-owner reading a manual show
            sees the "generate now" option (jimmy, 2026-11-26). The API still
            owner-gates the POST at middleware. */}
        {owner || show.cadence === "manual" ? <GeneratePanel
          showId={id}
          activeBriefings={activeBriefings}
          narrationMode={show.narration_mode === "external" ? "external" : "auto"}
        /> : null}

        {owner ? <ShowSpecPanel showId={id} /> : null}

        {owner ? <SteeringPanel showId={id} initialStyleGuide={show.style_guide} initialRules={pronunciations} /> : null}

        <EpisodesPanel
          initialEpisodes={episodes}
          runs={runs}
          qaRuns={qaRuns}
          owner={owner}
          rssToken={show.rss_token}
        />
      </div>
    </>
  );
}
