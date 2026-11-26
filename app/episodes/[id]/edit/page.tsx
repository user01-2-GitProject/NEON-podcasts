import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { splitIntoSentences } from "@/lib/audio-splice";
import { sql } from "@/lib/db";
import ThemeToggle from "@/components/ThemeToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EpisodeRow = {
  id: string;
  show_id: string;
  title: string;
  script: string;
  audio_url: string | null;
  status: string;
  show_title: string;
};

// Owner-only page (middleware gates the splice POST; this gates the screen).
// Each sentence is its own form: edit the one line that was read wrong and
// submit only that form. The server re-reads that sentence to the end in the
// show's voice and crossfades it into the existing mp3.
export default async function EditEpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; fixed?: string; stubbed?: string }>;
}) {
  const session = await auth();
  const owner = (session?.user as { role?: string } | undefined)?.role === "owner";
  const { id } = await params;
  const query = await searchParams;

  const rows = (await sql`
    select e.*, s.title as show_title
    from episodes e join shows s on s.id = e.show_id
    where e.id = ${id}
  `) as EpisodeRow[];
  const episode = rows[0];
  if (!episode) notFound();
  if (!owner) redirect(`/shows/${episode.show_id}`);

  const sentences = splitIntoSentences(episode.script || "");
  const fixed = Number(query.fixed);

  return (
    <>
      <header className="topbar">
        <h1>
          <span className="brand">NEON</span> Podcasts
        </h1>
        <Link href={`/shows/${episode.show_id}`} className="btn secondary">
          ← Back to {episode.show_title}
        </Link>
        <ThemeToggle />
      </header>
      <div className="container">
        <div className="panel">
          <h2>Fix one sentence: {episode.title}</h2>
          <p className="muted">
            Edit the sentence that was read wrong and press <strong>Fix this sentence</strong>. Only that sentence and
            the ones after it are re-read in this show&apos;s voice; the rest of the audio stays as it is.
          </p>

          {query.saved === "1" ? (
            <div className="notice-safe" role="status">
              <strong>Fixed.</strong> The new audio and transcript are saved.
              {query.stubbed === "1" ? " Sentence timing was estimated — have a listen at the join." : ""}
            </div>
          ) : null}
          {query.error ? (
            <div className="error" role="alert">{query.error}</div>
          ) : null}

          <div className="notice-safe" role="note">
            <strong>Accuracy note:</strong> this voice service does not return per-sentence timestamps. The join is
            estimated from sentence word counts, so a pause or an unusually paced sentence can shift it by a fraction
            of a second. Listen before publishing.
          </div>

          {episode.audio_url ? (
            <audio controls preload="none" src={episode.audio_url} />
          ) : (
            <p className="error">
              This episode has no audio yet. Make audio from the show page first.
            </p>
          )}

          {sentences.length === 0 ? (
            <p className="muted">There is no transcript to edit yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              {sentences.map((sentence, i) => (
                <form
                  key={sentence.index}
                  method="post"
                  action={`/api/episodes/${episode.id}/splice`}
                  className="panel"
                  style={{ padding: 12, border: i === fixed ? "2px solid var(--accent)" : undefined }}
                >
                  <input type="hidden" name="sentenceIndex" value={i} />
                  <label htmlFor={`sentence-${i}`}>
                    <strong>Sentence {i + 1}</strong>
                    {i === fixed ? " — just fixed" : ""}
                  </label>
                  <textarea
                    id={`sentence-${i}`}
                    name="text"
                    rows={3}
                    maxLength={4000}
                    required
                    style={{ width: "100%", margin: "6px 0" }}
                  >
                    {sentence.text}
                  </textarea>
                  <button type="submit" className="btn" disabled={!episode.audio_url}>
                    Fix this sentence
                  </button>
                </form>
              ))}
            </div>
          )}

          <p className="muted" style={{ marginTop: 16 }}>
            Need the whole script? <a href={`/api/episodes/${episode.id}/script`}>Download it as Markdown</a>.
          </p>
        </div>
      </div>
    </>
  );
}
