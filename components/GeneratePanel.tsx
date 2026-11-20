"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GeneratePanel({
  showId,
  activeBriefings,
}: {
  showId: string;
  activeBriefings: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/shows/${showId}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setDone(data.episode?.title || "Episode generated");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Generate an episode</h2>
      <p className="muted">
        Reads the active briefing(s), writes a script with Claude, renders audio with your TTS
        provider, and saves a downloadable episode.
      </p>
      {activeBriefings === 0 ? (
        <p className="muted">
          No active briefings — the episode will be a short general one. Upload a briefing above for
          real content.
        </p>
      ) : (
        <p className="muted">{activeBriefings} active briefing(s) will be used.</p>
      )}
      <div style={{ marginTop: 12 }}>
        <button onClick={generate} disabled={busy}>
          {busy ? "Generating… (this can take a minute)" : "Generate now"}
        </button>
      </div>
      {done ? <p className="muted" style={{ marginTop: 10 }}>✅ {done}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
