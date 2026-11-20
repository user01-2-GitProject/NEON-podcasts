"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewShowForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [targetMinutes, setTargetMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          cadence,
          target_minutes: targetMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create show");
      router.push(`/shows/${data.show.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>New show</h2>
      <form onSubmit={submit}>
        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this show about? Tone, audience, style..."
        />

        <div className="row">
          <div>
            <label htmlFor="cadence">Cadence</label>
            <select id="cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div>
            <label htmlFor="minutes">Target minutes</label>
            <input
              id="minutes"
              type="number"
              min={1}
              max={120}
              value={targetMinutes}
              onChange={(e) => setTargetMinutes(Number(e.target.value))}
            />
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        <div style={{ marginTop: 14 }}>
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create show"}
          </button>
        </div>
      </form>
    </div>
  );
}
