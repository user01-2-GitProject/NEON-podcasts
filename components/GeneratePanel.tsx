"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NarrationMode } from "@/lib/types";

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
  const [mode, setMode] = useState<NarrationMode>(narrationMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      if (data.voice_error) {
        setError(`${data.episode?.title || "Episode"}: ${data.voice_error}`);
        router.refresh();
        return;
      }
      setDone(
        mode === "external"
          ? `${data.episode?.title || "Draft"} — script ready. Download it, narrate externally, then upload the audio below.`
          : data.episode?.title || "Episode generated",
      );
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
        Reads the active briefing(s) and writes a script with Claude. Then either renders the audio
        for you, or hands you the script to narrate externally.
      </p>

      <div style={{ marginTop: 10 }}>
        <label htmlFor="mode">Narration</label>
        <select
          id="mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as NarrationMode)}
        >
          <option value="auto">Auto — app renders the audio (TTS)</option>
          <option value="external">Script only — I narrate externally (e.g. Muse)</option>
        </select>
      </div>

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
          {busy
            ? "Generating… (this can take a minute)"
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
