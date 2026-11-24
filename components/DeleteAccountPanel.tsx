"use client";

import { useState } from "react";

export default function DeleteAccountPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!window.confirm("This permanently deletes your account, tokens, and your content. This cannot be undone.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to delete account");
      window.location.assign("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Delete account</h2>
      <p className="muted">Permanently delete your account, tokens, subscriptions, and content.</p>
      {error ? <p className="error">{error}</p> : null}
      <button type="button" className="secondary" disabled={busy} onClick={deleteAccount}>
        {busy ? "Deleting…" : "Delete account"}
      </button>
    </section>
  );
}
