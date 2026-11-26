import Link from "next/link";
import { artworkPath } from "@/lib/cover";
import { notFound } from "next/navigation";
import AudioPlayer from "@/components/AudioPlayer";
import { sql } from "@/lib/db";
import type { Show, Episode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

// The app stores audio as a path to its own stream route. That route is public
// only when the show's rss_token is supplied (the same capability /feed uses),
// so attach it to the player and download links. External/absolute URLs from a
// future CDN are left untouched.
function publicAudioUrl(audioUrl: string | null, token: string): string | null {
  if (!audioUrl) return null;
  try {
    const url = new URL(audioUrl, "http://listen.local");
    if (!/^\/api\/episodes\/[^/]+\/audio$/.test(url.pathname)) return audioUrl;
    url.searchParams.set("feed", token);
    return audioUrl.startsWith("/") ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return audioUrl;
  }
}

function withDownload(src: string): string {
  return `${src}${src.includes("?") ? "&" : "?"}download=1`;
}

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

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds < 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

export default async function ListenPage({ params }: Params) {
  const { token } = await params;

  const shows = (await sql`select * from shows where rss_token = ${token} and is_active limit 1`) as Show[];
  const show = shows[0];
  if (!show) notFound();

  const episodes = (await sql`
    select * from episodes
    where show_id = ${show.id} and status = 'published'
    order by published_at desc nulls last, created_at desc
  `) as Episode[];

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href={`/feed/${token}`} className="btn secondary">
          RSS feed
        </Link>
      </header>

      <div className="container">
        <div className="panel">
          <img className="show-art" src={artworkPath(show)} alt={`${show.title} artwork`} />
          <h2>{show.title}</h2>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
            {show.description || "No description."}
          </p>
        </div>

        <div className="panel">
          <h2>Episodes</h2>
          {episodes.length === 0 ? (
            <p className="muted">No published episodes yet.</p>
          ) : (
            episodes.map((episode) => {
              const src = publicAudioUrl(episode.audio_url, token);
              const duration = formatDuration(episode.duration_seconds);
              return (
                <article className="panel" key={episode.id}>
                  <h2>{episode.title}</h2>
                  <p className="muted">
                    {formatDate(episode.published_at)}
                    {duration ? ` · ${duration}` : ""}
                  </p>
                  {src ? (
                    <AudioPlayer src={src} title={episode.title} />
                  ) : (
                    <p className="muted">Audio is not available for this episode yet.</p>
                  )}
                  {episode.show_notes ? (
                    <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                      {episode.show_notes}
                    </p>
                  ) : null}
                  {src ? (
                    <p>
                      <a href={withDownload(src)} download>
                        Download episode
                      </a>
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
