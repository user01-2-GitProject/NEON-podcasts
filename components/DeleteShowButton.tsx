"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Deletes a show (and, via ON DELETE CASCADE, its briefings, episodes, audio and
// runs) through DELETE /api/shows/[id]. Uses an inline two-step confirm rather
// than a blocking window.confirm dialog.
export default function DeleteShowButton({
  showId,
  showTitle,
}: {
  showId: string;
  showTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      // Back to the dashboard; the show is gone.
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div style={{ marginTop: 14 }}>
        <button className="danger" type="button" onClick={() => setConfirming(true)}>
          Delete show
        </button>
        {error ? <div className="error">{error}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <p className="muted">
        Delete “{showTitle}” and all of its briefings, episodes and audio? This can’t be undone.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="danger" type="button" onClick={doDelete} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete it"}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
