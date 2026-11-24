"use client";

import { useEffect, useState } from "react";

type LimitsView = {
  episodes_per_day: number;
  cost_cents_per_day: number;
  defaults: { episodes_per_day: number; cost_cents_per_day: number };
};

// Owner-only editor for the daily generation caps that apply to non-owners.
export default function LimitsPanel() {
  const [view, setView] = useState<LimitsView | null>(null);
  const [episodes, setEpisodes] = useState("");
  const [costCents, setCostCents] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function apply(data: LimitsView) {
    setView(data);
    setEpisodes(String(data.episodes_per_day));
    setCostCents(String(data.cost_cents_per_day));
  }

  async function request(init?: RequestInit) {
    const res = await fetch("/api/limits", init);
    const data = (await res.json().catch(() => ({}))) as LimitsView & { error?: string };
    if (!res.ok) throw new Error(data.error || "Request failed");
    apply(data);
  }

  useEffect(() => {
    request().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await request({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Number("") is 0 and Number("1.5") is 1.5; the API rejects non-integers.
        body: JSON.stringify({ episodes_per_day: Number(episodes), cost_cents_per_day: Number(costCents) }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Generation limits</h2>
      <p className="muted">
        Daily caps for members and their agents, counted over a rolling 24 hours. Owners are unlimited. Set a cap to
        0 to stop non-owners generating.
      </p>
      {view === null && !error ? <p className="muted">Loading…</p> : null}
      <form onSubmit={save}>
        <div className="row">
          <div>
            <label htmlFor="limit-episodes">Episodes per day</label>
            <input
              id="limit-episodes"
              type="number"
              min={0}
              step={1}
              required
              value={episodes}
              onChange={(e) => setEpisodes(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="limit-cost">Cost per day (cents)</label>
            <input
              id="limit-cost"
              type="number"
              min={0}
              step={1}
              required
              value={costCents}
              onChange={(e) => setCostCents(e.target.value)}
            />
          </div>
        </div>
        {view ? (
          <p className="muted" style={{ marginTop: 6 }}>
            Currently {view.episodes_per_day} episodes and ${(view.cost_cents_per_day / 100).toFixed(2)} per day.
            Defaults: {view.defaults.episodes_per_day} episodes, ${(view.defaults.cost_cents_per_day / 100).toFixed(2)}.
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="muted" style={{ marginTop: 8 }}>✅ Saved</p> : null}
        <div style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy || view === null}>
            {busy ? "Saving…" : "Save limits"}
          </button>
        </div>
      </form>
    </div>
  );
}
