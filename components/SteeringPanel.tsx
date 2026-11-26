"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Pronunciation } from "@/lib/types";
import TrickyWordsFinder from "@/components/TrickyWordsFinder";

export default function SteeringPanel({
  showId,
  initialStyleGuide,
  initialRules,
}: {
  showId: string;
  initialStyleGuide: string;
  initialRules: Pronunciation[];
}) {
  const router = useRouter();
  const [styleGuide, setStyleGuide] = useState(initialStyleGuide);
  const [term, setTerm] = useState("");
  const [sayAs, setSayAs] = useState("");
  const [matchMode, setMatchMode] = useState<"word" | "substring">("word");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveStyleGuide() {
    await send(`/api/shows/${showId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style_guide: styleGuide }),
    });
  }

  async function addPronunciation() {
    const saved = await send(`/api/shows/${showId}/pronunciations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term, say_as: sayAs, match_mode: matchMode }),
    });
    if (saved) {
      setTerm("");
      setSayAs("");
    }
  }

  async function deletePronunciation(id: string) {
    await send(`/api/shows/${showId}/pronunciations/${id}`, { method: "DELETE" });
  }

  return (
    <div className="panel">
      <h2>Show steering</h2>
      <p className="muted">
        Style guidance is added to the script-writing prompt. Tricky words are fixed just before the
        voice reads the script; the saved script keeps the real spelling.
      </p>

      <div style={{ marginTop: 10 }}>
        <label htmlFor="style-guide">Style guide</label>
        <textarea
          id="style-guide"
          value={styleGuide}
          onChange={(e) => setStyleGuide(e.target.value)}
          rows={5}
          placeholder="e.g. Write in a calm, curious tone. Avoid hype."
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={saveStyleGuide} disabled={busy}>
          Save style guide
        </button>
      </div>

      <h2 style={{ marginTop: 18 }} id="tricky-words">Tricky words</h2>
      <p className="muted">
        Words the host says wrong, like a player&apos;s name or &quot;rebound&quot;. Write how it should
        sound, the way you&apos;d spell it for a friend. Words that must never be said on air go
        here too, with what to say instead.
      </p>
      {initialRules.length === 0 ? (
        <p className="muted">No tricky words yet.</p>
      ) : (
        <ul className="tricky-list">
          {initialRules.map((rule) => (
            <li key={rule.id} className="tricky-row">
              <strong>{rule.term}</strong>
              <span>
                says &quot;{rule.say_as}&quot;
                {rule.match_mode === "substring" ? <span className="muted"> (inside words too)</span> : null}
              </span>
              <button onClick={() => deletePronunciation(rule.id)} disabled={busy} aria-label={`Remove ${rule.term}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 10 }}>
        <label htmlFor="pron-term">Word</label>
        <input id="pron-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. rebound" />
        <label htmlFor="pron-say">Say it like</label>
        <input id="pron-say" value={sayAs} onChange={(e) => setSayAs(e.target.value)} placeholder="e.g. REE-bound" />
        <details style={{ marginTop: 6 }}>
          <summary className="muted">More</summary>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              style={{ width: "auto", margin: 0 }}
              checked={matchMode === "substring"}
              onChange={(e) => setMatchMode(e.target.checked ? "substring" : "word")}
            />
            Also fix it inside longer words
          </label>
        </details>
        <button onClick={addPronunciation} disabled={busy || !term.trim() || !sayAs.trim()} style={{ marginTop: 8 }}>
          Add
        </button>
      </div>

      <TrickyWordsFinder
        showId={showId}
        have={initialRules.map((r) => r.term)}
        onAdd={async (t, s) => {
          await send(`/api/shows/${showId}/pronunciations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ term: t, say_as: s, match_mode: "word" }),
          });
        }}
      />
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
