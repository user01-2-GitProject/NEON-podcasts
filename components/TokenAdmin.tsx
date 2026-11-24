"use client";

import { useEffect, useState } from "react";

type AdminToken = {
  id: string;
  label: string;
  scope: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function fmt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function TokenAdmin() {
  const [tokens, setTokens] = useState<AdminToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"read_only" | "read_write">("read_only");
  const [created, setCreated] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/tokens");
      const data = (await res.json()) as { tokens?: AdminToken[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load tokens");
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), scope }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to create token");
      setCreated(data.token || null);
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
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

  return (
    <section className="panel">
      <h2>All API tokens (owner)</h2>
      <p className="muted">Every token in the workspace. Create one for automation or a device.</p>
      {error ? <p className="error">{error}</p> : null}

      <form action="#" onSubmit={create}>
        <label htmlFor="token-label">Label</label>
        <input
          id="token-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          required
        />
        <label htmlFor="token-scope">Scope</label>
        <select id="token-scope" value={scope} onChange={(e) => setScope(e.target.value as "read_only" | "read_write")}>
          <option value="read_only">read_only</option>
          <option value="read_write">read_write</option>
        </select>
        <div style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy || label.trim() === ""}>
            Create token
          </button>
        </div>
      </form>

      {created ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Copy this token now — it is shown only once:
          <br />
          <code>{created}</code>
        </p>
      ) : null}

      {tokens === null ? (
        <p className="muted">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="muted">No tokens yet.</p>
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
                    <button type="button" className="secondary" disabled={busy} onClick={() => revoke(t.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
