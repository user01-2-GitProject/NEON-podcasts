"use client";

// Owner-only button that flips the NEON-official badge on a show (jimmy,
// 2026-11-26). Hidden on member sessions by the parent page.

import { useState } from "react";

export default function OfficialToggle({ showId, initialOfficial }: {
  showId: string;
  initialOfficial: boolean;
}) {
  const [official, setOfficial] = useState(initialOfficial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !official;
    try {
      const res = await fetch(`/api/shows/${showId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_official: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "That didn't save. Try again.");
      }
      setOfficial(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn secondary" disabled={busy} onClick={toggle}>
        {busy ? "Saving…" : official ? "Remove NEON-official badge" : "Mark as NEON-official"}
      </button>
      {error ? <p className="error" style={{ marginTop: 4 }}>{error}</p> : null}
    </>
  );
}
