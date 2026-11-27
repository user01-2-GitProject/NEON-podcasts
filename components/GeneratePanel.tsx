"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { NarrationMode } from "@/lib/types";
import { pollRun, readJson } from "@/components/generation-client";

export default function GeneratePanel({
  showId,
  activeBriefings,
  narrationMode,
}: {
  showId: string;
  activeBriefings: number;
  narrationMode: NarrationMode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<NarrationMode>(narrationMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(searchParams.get("runId"));

  useEffect(() => {
    if (!runId) return;
    let active = true;
    setBusy(true);
    pollRun(runId).then((run) => {
      if (!active) return;
      if (run.status === "failed") setError(run.error || "Generation didn't finish — try again");
      else setDone("Episode generated");
      setBusy(false);
      router.refresh();
    }).catch((e) => { if (active) { setError(e.message); setBusy(false); } });
    return () => { active = false; };
  }, [runId, router]);

  async function generate() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/shows/${showId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await readJson<{ runId: string }>(res, "start-generation");
      setRunId(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Make an episode</h2>
      <p className="muted">
        Writes a script from your show and its source material, then reads it aloud for you (or gives you the
        script to record yourself).
      </p>

      <div style={{ marginTop: 10 }}>
        <label htmlFor="mode">Who reads it?</label>
        <select
          id="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as NarrationMode)}
        >
          <option value="auto">The app reads it aloud</option>
          <option value="external">Just the script, I'll record it myself</option>
        </select>
      </div>

      {activeBriefings === 0 ? (
        <p className="muted">
          No source material in use, so this episode will be general. Add notes, a link or a document above
          for real content.
        </p>
      ) : (
        <p className="muted">
          Using {activeBriefings} piece{activeBriefings === 1 ? "" : "s"} of source material.
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <button onClick={generate} disabled={busy}>
          {busy
            ? "Making it… (~a few minutes)"
            : mode === "external"
              ? "Generate script"
              : "Generate now"}
        </button>
      </div>
      {done ? <p className="muted" style={{ marginTop: 10 }}>✅ {done}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
