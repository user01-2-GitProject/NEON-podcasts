"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Briefing } from "@/lib/types";

export default function BriefingsPanel({
  showId,
  initialBriefings,
  owner,
}: {
  showId: string;
  initialBriefings: Briefing[];
  owner: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/shows/${showId}/briefings`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: Briefing) {
    await fetch(`/api/shows/${showId}/briefings/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !b.is_active }),
    });
    router.refresh();
  }

  async function remove(b: Briefing) {
    await fetch(`/api/shows/${showId}/briefings/${b.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="panel">
      <h2>Briefings (.md)</h2>
      <p className="muted">
        Active briefings are read before every episode and used as the source material for the
        script.
      </p>

      {owner ? <form onSubmit={upload}>
        <label htmlFor="briefing">Upload a Markdown file</label>
        <input id="briefing" ref={fileRef} type="file" accept=".md,.markdown,text/markdown,text/plain" />
        {error ? <p className="error">{error}</p> : null}
        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Uploading…" : "Upload briefing"}
          </button>
        </div>
      </form> : null}

      <div style={{ marginTop: 16 }}>
        {initialBriefings.length === 0 ? (
          <p className="muted">No briefings uploaded yet.</p>
        ) : (
          initialBriefings.map((b) => (
            <div className="list-item" key={b.id}>
              <div>
                <strong>{b.filename}</strong>{" "}
                <span className={`tag ${b.is_active ? "active" : ""}`}>
                  {b.is_active ? "active" : "inactive"}
                </span>
                <div className="muted">{b.content_md.length} chars</div>
              </div>
              {owner ? <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary" onClick={() => toggle(b)}>
                  {b.is_active ? "Deactivate" : "Activate"}
                </button>
                <button className="danger" onClick={() => remove(b)}>
                  Delete
                </button>
              </div> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
