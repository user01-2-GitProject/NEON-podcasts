"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Episode, Run } from "@/lib/types";

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

export default function EpisodesPanel({
  initialEpisodes,
  runs,
}: {
  initialEpisodes: Episode[];
  runs: Run[];
}) {
  const failedRuns = runs.filter((r) => r.status === "failed");

  return (
    <div className="panel">
      <h2>Episodes</h2>

      {failedRuns.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          {failedRuns.slice(0, 2).map((r) => (
            <p className="error" key={r.id}>
              Last run failed: {r.error}
            </p>
          ))}
        </div>
      ) : null}

      {initialEpisodes.length === 0 ? (
        <p className="muted">No episodes yet. Generate one above.</p>
      ) : (
        initialEpisodes.map((ep) => (
          <div className="list-item" key={ep.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <strong>{ep.title}</strong>{" "}
                <span className={`tag ${ep.status === "failed" ? "failed" : ep.status === "published" ? "active" : ""}`}>
                  {ep.status}
                </span>
                <div className="muted">
                  {fmtDuration(ep.duration_seconds)} · {fmtSize(ep.byte_size)} ·{" "}
                  {new Date(ep.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <a className="btn secondary" href={`/api/episodes/${ep.id}/script`}>
                  Download script (.md)
                </a>
                {ep.audio_url ? (
                  <a className="btn" href={`${ep.audio_url}?download=1`}>
                    Download mp3
                  </a>
                ) : (
                  <UploadAudio episodeId={ep.id} />
                )}
              </div>
            </div>

            {!ep.audio_url ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Script-only draft. Narrate it externally (e.g. in Muse), then upload the finished
                audio to publish this episode.
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
        ))
      )}
    </div>
  );
}
