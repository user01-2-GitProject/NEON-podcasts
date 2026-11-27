"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import OfficialBadge from "@/components/OfficialBadge";
import type { Episode, Run } from "@/lib/types";
import type { ScriptQa, ScriptQaKind } from "@/lib/script-qa";

const QA_LABELS: Record<ScriptQaKind, string> = {
  swear: "Swear",
  number: "Number",
  acronym: "Acronym",
  "long-line": "Long line",
  "self-name": "Host name",
};

// The most recent QA pass for an episode, even if its run has scrolled out of
// the run-history list (page.tsx fetches these separately).
function qaForEpisode(
  episodeId: string,
  qaRuns: Pick<Run, "episode_id" | "script_qa">[],
): ScriptQa | null {
  for (const run of qaRuns) {
    if (run.episode_id !== episodeId) continue;
    const qa = run.script_qa;
    if (qa && Array.isArray(qa.notes) && qa.notes.length) return qa;
  }
  return null;
}

function QaNotes({ qa }: { qa: ScriptQa }) {
  return (
    <details className="qa-notes">
      <summary className="tag qa" aria-label={`Show ${qa.notes.length} script QA notes`}>
        {qa.notes.length} QA note{qa.notes.length === 1 ? "" : "s"}
      </summary>
      <ul>
        {qa.notes.map((note, i) => (
          <li key={`${note.kind}-${i}`}>
            <strong>{QA_LABELS[note.kind] || "Note"}:</strong> {String(note.message ?? "")}
            {typeof note.excerpt === "string" && note.excerpt ? (
              <span className="muted"> — “{note.excerpt}”</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Fact-check data lives in runs.fact_check. The shapes below are deliberately
// structural: they survive the JSON round trip and keep this panel independent
// of the server-side council library.
const PERSONA_LABELS: Record<string, string> = {
  quickdraw: "Quickdraw",
  scholar: "Scholar",
  lead: "Lead",
  free_models: "Free models",
};
const FACT_CHECK_LABELS: Record<string, string> = {
  wrong: "Wrong",
  unsupported: "Unsupported",
  outdated: "Outdated",
  "missing-context": "Missing context",
};

interface FactCheckNoteView {
  kind: string;
  message: string;
  excerpt?: string;
  /** How many of the three automatic checkers flagged this note. */
  agreed?: number;
}
interface CouncilFlagView extends FactCheckNoteView {
  persona: string;
}
interface CouncilDismissalView {
  flag: CouncilFlagView;
  reason: string;
  flagger_agrees?: boolean;
}
interface GradeView {
  score: string;
  tags?: string[];
  error_types?: string[];
  caught_by?: Record<string, number>;
  notes?: string;
}
interface AddedSourceView {
  url: string;
  by?: string;
  accepted?: boolean;
}
interface FactCheckView {
  notes?: FactCheckNoteView[];
  model?: string | null;
  checked_at?: string;
  agent_notes?: CouncilFlagView[];
  verdict?: "pass" | "fail" | null;
  council?: { verdict?: "pass" | "fail"; decided_at?: string } | null;
  grade?: GradeView | null;
  dismissed?: CouncilDismissalView[];
  added_sources?: AddedSourceView[];
}
export type FactCheckRunView = Pick<Run, "episode_id" | "script_qa"> & {
  fact_check?: FactCheckView | null;
  /** Present on the server query; stripped before the props cross to the client. */
  briefing_snapshot?: string | null;
};

function personaLabel(key: string | undefined): string {
  return (key && PERSONA_LABELS[key]) || key || "Checker";
}

function factCheckHasInfo(fc: FactCheckView | null): boolean {
  if (!fc) return false;
  return Boolean(
    fc.notes?.length ||
      fc.agent_notes?.length ||
      fc.dismissed?.length ||
      fc.added_sources?.length ||
      fc.verdict ||
      fc.council ||
      fc.grade ||
      fc.model ||
      fc.checked_at,
  );
}

// The most recent fact check for an episode, even if its run has scrolled out
// of the run-history list (page.tsx fetches these separately).
function factCheckForEpisode(episodeId: string, runs: FactCheckRunView[]): FactCheckView | null {
  for (const run of runs) {
    if (run.episode_id !== episodeId) continue;
    if (factCheckHasInfo(run.fact_check ?? null)) return run.fact_check ?? null;
  }
  return null;
}

function FactCheckNotes({
  factCheck,
  councilEnabled,
}: {
  factCheck: FactCheckView | null;
  councilEnabled: boolean;
}) {
  const verdict = factCheck?.verdict ?? factCheck?.council?.verdict ?? null;
  const badge = verdict
    ? verdict === "pass"
      ? "Pass"
      : "Fail"
    : councilEnabled
      ? "Awaiting council"
      : "Pending";
  const notes = factCheck?.notes ?? [];
  const flags = factCheck?.agent_notes ?? [];
  const dismissed = factCheck?.dismissed ?? [];
  const addedSources = factCheck?.added_sources ?? [];
  const grade = factCheck?.grade;
  const headingStyle = { color: "var(--warn)" };
  const listStyle = { margin: "4px 0 0", paddingLeft: 18 };

  return (
    <details className="qa-notes fact-check-notes">
      <summary className="tag qa" aria-label="Show fact-check notes">
        Fact-check notes
      </summary>
      <div style={{ marginTop: 8, fontSize: 13, maxWidth: 640 }}>
        <p style={{ margin: "0 0 6px" }}>
          <strong style={headingStyle}>Council verdict:</strong>{" "}
          <span className="tag qa" style={{ marginLeft: 0 }}>{badge}</span>
        </p>
        {factCheck?.checked_at || factCheck?.model ? (
          <p className="muted" style={{ margin: "0 0 6px" }}>
            Automatic check
            {factCheck.checked_at ? ` on ${new Date(factCheck.checked_at).toLocaleString()}` : ""}
            {factCheck.model ? ` by ${factCheck.model}` : ""}
          </p>
        ) : null}
        {factCheck?.council?.decided_at ? (
          <p className="muted" style={{ margin: "0 0 6px" }}>
            Council decided {new Date(factCheck.council.decided_at).toLocaleString()}
          </p>
        ) : null}
        {grade ? (
          <>
            <p style={{ margin: "0 0 6px" }}>
              <strong style={headingStyle}>Grade {grade.score}</strong>
              {grade.tags?.map((tag) => (
                <span className="tag qa" key={tag} style={{ marginLeft: 6 }}>{tag}</span>
              ))}
            </p>
            {grade.error_types?.length ? (
              <p style={{ margin: "0 0 6px" }}>
                <strong>Error types:</strong> {grade.error_types.join(", ")}
              </p>
            ) : null}
            {grade.caught_by ? (
              <p style={{ margin: "0 0 6px" }}>
                <strong>Caught by:</strong>{" "}
                {Object.entries(grade.caught_by)
                  .map(([who, count]) => `${personaLabel(who)} ${count}`)
                  .join(" · ")}
              </p>
            ) : null}
          </>
        ) : null}
        {notes.length ? (
          <>
            <p style={{ margin: "6px 0 0" }}>
              <strong style={headingStyle}>Automatic check notes:</strong>
            </p>
            <ul style={listStyle}>
              {notes.map((note, i) => (
                <li key={`${note.kind}-${i}`}>
                  <strong>{FACT_CHECK_LABELS[note.kind] || "Note"}:</strong> {note.message}
                  {typeof note.excerpt === "string" && note.excerpt ? (
                    <span className="muted"> — “{note.excerpt}”</span>
                  ) : null}
                  {typeof note.agreed === "number" && note.agreed > 0 ? (
                    <span className="muted"> — {note.agreed} of 3 models agreed</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted" style={{ margin: "6px 0 0" }}>No automatic check notes.</p>
        )}
        {flags.length ? (
          <>
            <p style={{ margin: "6px 0 0" }}>
              <strong style={headingStyle}>Council flags:</strong>
            </p>
            <ul style={listStyle}>
              {flags.map((flag, i) => (
                <li key={`${flag.persona}-${i}`}>
                  <span className="tag qa" style={{ marginRight: 6 }}>{personaLabel(flag.persona)}</span>
                  <strong>{FACT_CHECK_LABELS[flag.kind] || "Note"}:</strong> {flag.message}
                  {typeof flag.excerpt === "string" && flag.excerpt ? (
                    <span className="muted"> — “{flag.excerpt}”</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {dismissed.length ? (
          <>
            <p style={{ margin: "6px 0 0" }}>
              <strong style={headingStyle}>Dismissed flags:</strong>
            </p>
            <ul style={listStyle}>
              {dismissed.map((item, i) => (
                <li key={`${item.flag.persona}-${i}`}>
                  <span className="tag qa" style={{ marginRight: 6 }}>
                    {personaLabel(item.flag.persona)}
                  </span>
                  <strong>{FACT_CHECK_LABELS[item.flag.kind] || "Note"}:</strong>{" "}
                  {item.flag.message} — <strong>Lead said:</strong> {item.reason}
                  {item.flagger_agrees === false ? (
                    <span className="muted"> · The flagger still disagrees</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {addedSources.length ? (
          <>
            <p style={{ margin: "6px 0 0" }}>
              <strong style={headingStyle}>Added sources:</strong>
            </p>
            <ul style={listStyle}>
              {addedSources.map((source, i) => (
                <li key={`${source.url}-${i}`}>
                  {source.url} — by {personaLabel(source.by)}
                  {typeof source.accepted === "boolean"
                    ? source.accepted
                      ? " · accepted by Lead"
                      : " · not accepted by Lead"
                    : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {grade?.notes ? (
          <p style={{ margin: "6px 0 0" }}>
            <strong style={headingStyle}>Lead notes:</strong> {grade.notes}
          </p>
        ) : null}
      </div>
    </details>
  );
}

// Clipboard fallback for owners who want to run a council persona themselves.
function CopyCouncilPromptButton({ label, prompt }: { label: string; prompt: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="btn secondary" onClick={copyPrompt}>
      {copied ? "Copied" : label}
    </button>
  );
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadAudio({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/episodes/${episodeId}/audio`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav"
        style={{ display: "none" }}
        onChange={onFile}
      />
      <button
        className="btn secondary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading…" : "Upload audio"}
      </button>
      {error ? <span className="error" style={{ marginLeft: 8 }}>{error}</span> : null}
    </span>
  );
}

function MakeAudioButton({ episodeId, redo = false }: { episodeId: string; redo?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function makeAudio() {
    // Redo replaces audio listeners may already have, so it takes two taps.
    if (redo && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/narrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't make the audio");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const label = busy
    ? "Making audio… (about a minute)"
    : redo
      ? armed
        ? "Tap again to replace the audio"
        : "Redo audio"
      : "Make audio";
  return (
    <span>
      <button className={redo && !armed ? "btn secondary" : "btn"} disabled={busy} onClick={makeAudio}>
        {label}
      </button>
      {error ? <span className="error" style={{ marginLeft: 8 }}>{error}</span> : null}
    </span>
  );
}

function RegenerateButton({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    // This replaces the script and the mp3 at the same URL, so take two taps.
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't make a new episode");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <span>
      <button
        className={armed ? "btn" : "btn secondary"}
        disabled={busy}
        onClick={regenerate}
        title="Use the show's current setup to write and voice this episode again"
      >
        {busy
          ? "Making a new version… (about a minute)"
          : armed
            ? "Tap again to replace this episode"
            : "Regenerate with the latest setup"}
      </button>
      {error ? <span className="error" style={{ marginLeft: 8 }}>{error}</span> : null}
    </span>
  );
}

function PublishButton({ episode }: { episode: Episode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = episode.status !== "published";

  async function updateStatus() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: publish ? "published" : "draft" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className={publish ? "btn" : "btn secondary"} disabled={busy} onClick={updateStatus}>
        {busy ? "Updating…" : publish ? "Publish" : "Unpublish"}
      </button>
      {error ? <span className="error" style={{ marginLeft: 8 }}>{error}</span> : null}
    </span>
  );
}

// Owner-only twin of OfficialToggle on the show page, but for one episode.
function OfficialToggle({ episodeId, initialOfficial }: { episodeId: string; initialOfficial: boolean }) {
  const router = useRouter();
  const [official, setOfficial] = useState(initialOfficial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !official;
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_official: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't save. Try again.");
      setOfficial(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn secondary" disabled={busy} onClick={toggle}>
        {busy ? "Saving…" : official ? "Remove NEON-official badge" : "Mark as NEON-official"}
      </button>
      {error ? <span className="error" style={{ marginLeft: 8 }}>{error}</span> : null}
    </span>
  );
}

export default function EpisodesPanel({
  initialEpisodes,
  runs,
  qaRuns = [],
  councilPrompts = {},
  councilEnabled = false,
  owner,
  rssToken,
}: {
  initialEpisodes: Episode[];
  runs: Run[];
  qaRuns?: FactCheckRunView[];
  /** Council prompts built on the server; empty for runs with no briefing. */
  councilPrompts?: Record<string, { quickdraw: string; scholar: string }>;
  councilEnabled?: boolean;
  owner: boolean;
  rssToken: string;
}) {
  return (
    <div className="panel episodes-panel">
      <h2>Episodes</h2>
      {owner ? (
        <p className="muted" style={{ overflowWrap: "anywhere" }}>
          RSS feed: <a href={`/feed/${rssToken}`}>{`/feed/${rssToken}`}</a>. Submit this URL once
          to Apple Podcasts Connect and Spotify for Podcasters; newly published episodes then
          appear there automatically.
        </p>
      ) : null}

      {initialEpisodes.length === 0 ? (
        <p className="muted">No episodes yet. Generate one above.</p>
      ) : (
        initialEpisodes.map((ep) => {
          const qa = owner ? qaForEpisode(ep.id, qaRuns) : null;
          const factCheck = owner ? factCheckForEpisode(ep.id, qaRuns) : null;
          const showFactCheck = owner && (councilEnabled || factCheckHasInfo(factCheck));
          const prompts = owner ? councilPrompts[ep.id] : undefined;
          return (
          <div className="list-item" key={ep.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                {ep.is_official ? <OfficialBadge size={18} /> : null}
                <strong>{ep.title}</strong>{" "}
                <span className={`tag ${ep.status === "failed" ? "failed" : ep.status === "published" ? "active" : ""}`}>
                  {ep.status}
                </span>{" "}
                {qa ? <QaNotes qa={qa} /> : null}
                {showFactCheck ? (
                  <FactCheckNotes factCheck={factCheck} councilEnabled={councilEnabled} />
                ) : null}
                <div className="muted">
                  {fmtDuration(ep.duration_seconds)} · {fmtSize(ep.byte_size)} ·{" "}
                  {new Date(ep.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <a className="btn secondary" href={`/api/episodes/${ep.id}/script`}>
                  Download script (.md)
                </a>
                {owner && ep.audio_url && ep.script ? (
                  <Link href={`/episodes/${ep.id}/edit`} className="btn secondary">
                    ✏️ Fix a sentence
                  </Link>
                ) : null}
                {ep.audio_url ? (
                  <>
                    <a className="btn" href={`${ep.audio_url}?download=1`}>
                      Download mp3
                    </a>
                    {owner && ep.script ? <MakeAudioButton episodeId={ep.id} redo /> : null}
                  </>
                ) : owner ? (
                  <>
                    {ep.script ? <MakeAudioButton episodeId={ep.id} /> : null}
                    <UploadAudio episodeId={ep.id} />
                  </>
                ) : null}
                {owner ? <RegenerateButton episodeId={ep.id} /> : null}
                {prompts ? (
                  <>
                    <CopyCouncilPromptButton label="Copy Quickdraw prompt" prompt={prompts.quickdraw} />
                    <CopyCouncilPromptButton label="Copy Scholar prompt" prompt={prompts.scholar} />
                  </>
                ) : null}
                {owner ? <PublishButton episode={ep} /> : null}
                {owner ? <OfficialToggle episodeId={ep.id} initialOfficial={!!ep.is_official} /> : null}
                {ep.status === "published" ? (
                  <a className="btn secondary" href={`/listen/${rssToken}`}>Public page</a>
                ) : null}
              </div>
            </div>

            {!ep.audio_url ? (
              <p className="muted" style={{ marginTop: 8 }}>
                No audio yet. Press Make audio to have the app read it, or narrate it yourself
                (e.g. in Muse) and upload the file, then publish.
              </p>
            ) : null}

            {ep.audio_url ? <audio controls preload="none" src={ep.audio_url} /> : null}

            {ep.show_notes ? (
              <details style={{ marginTop: 10 }}>
                <summary className="muted">Show notes</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{ep.show_notes}</pre>
              </details>
            ) : null}

            <details style={{ marginTop: 6 }}>
              <summary className="muted">Transcript / script</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{ep.script}</pre>
            </details>
          </div>
          );
        })
      )}

      <h3 style={{ marginTop: 24 }}>Run history</h3>
      {runs.length === 0 ? (
        <p className="muted">No generation runs yet.</p>
      ) : (
        runs.map((run) => {
          const episode = initialEpisodes.find((item) => item.id === run.episode_id);
          const cost = run.cost_cents === null ? "—" : `$${(run.cost_cents / 100).toFixed(2)}`;
          return (
            <div className="list-item" key={run.id}>
              <div>
                <span
                  className={`tag ${
                    run.status === "done" ? "active" : run.status === "failed" ? "failed" : ""
                  }`}
                >
                  {run.status}
                </span>{" "}
                <span className="muted">
                  {fmtDuration(episode?.duration_seconds ?? null)} · {cost}
                  {run.attempt_count > 0 ? ` · attempt ${run.attempt_count}/5` : ""}
                </span>
                {run.error ? <div className={run.status === "done" ? "muted" : "error"}>{run.error}</div> : null}
              </div>
              <span className="muted">{new Date(run.started_at).toLocaleString()}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
