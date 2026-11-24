"use client";

import { useEffect, useState } from "react";

type MeToken = {
  id: string;
  label: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function fmt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function DevicesPanel() {
  const [tokens, setTokens] = useState<MeToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/me/tokens");
      const data = (await res.json()) as { tokens?: MeToken[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load devices");
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revokeOne(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to revoke");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/tokens", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to sign out devices");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const active = (tokens || []).filter((t) => !t.revoked_at);

  return (
    <section className="panel">
      <h2>Devices &amp; tokens</h2>
      <p className="muted">Access tokens issued to your signed-in devices and apps.</p>
      {error ? <p className="error">{error}</p> : null}
      {tokens === null ? (
        <p className="muted">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="muted">No tokens yet. Signing in on the mobile app creates one.</p>
      ) : (
        <table className="tokens">
          <thead>
            <tr>
              <th>Label</th>
              <th>Scope</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{t.scope}</td>
                <td>{fmt(t.created_at)}</td>
                <td>{fmt(t.last_used_at)}</td>
                <td>{t.revoked_at ? `revoked ${fmt(t.revoked_at)}` : "active"}</td>
                <td>
                  {t.revoked_at ? null : (
                    <button type="button" className="secondary" disabled={busy} onClick={() => revokeOne(t.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {active.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <button type="button" disabled={busy} onClick={revokeAll}>
            Sign out all devices
          </button>
        </div>
      ) : null}
    </section>
  );
}
