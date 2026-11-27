import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import type { Show, Briefing, Episode, Run, Pronunciation } from "@/lib/types";
import BriefingsPanel from "@/components/BriefingsPanel";
import GeneratePanel from "@/components/GeneratePanel";
import SteeringPanel from "@/components/SteeringPanel";
import EpisodesPanel, { type FactCheckRunView } from "@/components/EpisodesPanel";
import ShowHero from "@/components/ShowHero";
import { buildCouncilPrompt } from "@/lib/fact-check";
import ShowSpecPanel from "@/components/ShowSpecPanel";
import { auth } from "@/auth";
import ThemeToggle from "@/components/ThemeToggle";

import "./show-detail.css";

export const runtime = "nodejs";
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

  // QA and fact-check notes belong to the episode card, which outlives the
  // run-history limit. The briefing snapshot also feeds the copyable prompts.
  const qaRunRows = (await sql`
    select episode_id, script_qa, fact_check, briefing_snapshot from runs
    where show_id = ${id} and episode_id is not null
      and (script_qa is not null or fact_check is not null or briefing_snapshot is not null)
    order by started_at desc
  `) as FactCheckRunView[];

  // Build the council prompts here, on the server, so the client only sees
  // finished strings. An episode needs a run with a briefing to offer them.
  const councilPrompts: Record<string, { quickdraw: string; scholar: string }> = {};
  if (owner) {
    for (const run of qaRunRows) {
      if (!run.episode_id || councilPrompts[run.episode_id]) continue;
      const episode = episodes.find((item) => item.id === run.episode_id);
      const briefing = run.briefing_snapshot;
      if (!episode?.script?.trim() || !briefing?.trim()) continue;
      const promptFor = (persona: "quickdraw" | "scholar") => {
        const { system, user } = buildCouncilPrompt(persona, episode.script, briefing);
        return `${system}\n\n${user}`;
      };
      councilPrompts[run.episode_id] = {
        quickdraw: promptFor("quickdraw"),
        scholar: promptFor("scholar"),
      };
    }
  }

  // Only the finished prompts cross to the client; briefing snapshots stay on
  // the server. The card needs the QA and fact-check columns, not the source.
  const qaRuns: FactCheckRunView[] = qaRunRows.map(({ episode_id, script_qa, fact_check }) => ({
    episode_id,
    script_qa,
    fact_check,
  }));

  const councilEnabled = !!show.fact_check_council;
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
        <ShowHero show={show} owner={owner} justSaved={justSaved}>
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
            councilPrompts={councilPrompts}
            councilEnabled={councilEnabled}
            owner={owner}
            rssToken={show.rss_token}
          />
        </ShowHero>
      </div>
    </>
  );
}
