"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Pronunciation } from "@/lib/types";

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
        Style guidance is added to the script-writing prompt. Pronunciation rules are applied just
        before text-to-speech; the stored episode script is never changed.
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

      <h2 style={{ marginTop: 18 }}>Pronunciations</h2>
      <p className="muted">
        Map a term to how it should sound, whole-word or anywhere it appears.
      </p>
      {initialRules.length === 0 ? (
        <p className="muted">No pronunciation rules yet.</p>
      ) : (
        <ul>
          {initialRules.map((rule) => (
            <li key={rule.id}>
              {rule.term} → {rule.say_as}{" "}
              <span className="muted">({rule.match_mode})</span>{" "}
              <button onClick={() => deletePronunciation(rule.id)} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 10 }}>
        <label htmlFor="pron-term">Term</label>
        <input id="pron-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="0" />
        <label htmlFor="pron-say">Say as</label>
        <input id="pron-say" value={sayAs} onChange={(e) => setSayAs(e.target.value)} placeholder="oh" />
        <label htmlFor="pron-mode">Match</label>
        <select
          id="pron-mode"
          value={matchMode}
          onChange={(e) => setMatchMode(e.target.value as "word" | "substring")}
        >
          <option value="word">Whole word</option>
          <option value="substring">Substring</option>
        </select>
        <button onClick={addPronunciation} disabled={busy}>
          Add
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
