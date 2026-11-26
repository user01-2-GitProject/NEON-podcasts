"use client";

import { useState } from "react";
import type { TrickySpot } from "@/lib/tricky-words";

// "Find tricky words for me": looks through the show's text for names, short
// forms and two-way words the voice may say wrong, and offers each one with a
// guess at how to say it. One tap adds it; the guess can be changed first.
export default function TrickyWordsFinder({
  showId,
  getText,
  have,
  onAdd,
}: {
  showId?: string;
  getText?: () => string;
  have: string[];
  onAdd: (term: string, sayAs: string) => void | Promise<void>;
}) {
  const [words, setWords] = useState<TrickySpot[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/tricky-words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_id: showId, text: getText ? getText() : "", have }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      setWords(data.words || []);
      setEdits({});
      setNote(data.note || ((data.words || []).length ? null : "No tricky words found. You can still add your own."));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const haveSet = new Set(have.map((t) => t.toLowerCase()));
  const left = (words || []).filter((w) => !haveSet.has(w.term.toLowerCase()));

  async function add(w: TrickySpot) {
    const sayAs = (edits[w.term] ?? w.say_as).trim();
    if (!sayAs) return;
    await onAdd(w.term, sayAs);
  }

  return (
    <div className="tricky-finder">
      <button type="button" className="secondary" onClick={find} disabled={busy}>
        {busy ? "Looking…" : words ? "Look again" : "Find tricky words for me"}
      </button>
      {note ? <p className="muted" style={{ marginTop: 6 }}>{note}</p> : null}
      {left.length ? (
        <ul className="tricky-list">
          {left.map((w) => (
            <li key={w.term} className="tricky-row">
              <div className="tricky-word">
                <strong>{w.term}</strong>
                <span className="muted tricky-why">{w.why}</span>
              </div>
              <input
                aria-label={`How to say ${w.term}`}
                value={edits[w.term] ?? w.say_as}
                onChange={(e) => setEdits({ ...edits, [w.term]: e.target.value })}
              />
              <button type="button" onClick={() => add(w)}>Add</button>
            </li>
          ))}
        </ul>
      ) : null}
      {left.length > 1 ? (
        <button
          type="button"
          className="secondary"
          style={{ marginTop: 6 }}
          onClick={async () => {
            for (const w of left) await add(w);
          }}
        >
          Add all {left.length}
        </button>
      ) : null}
    </div>
  );
}
