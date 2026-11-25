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

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [showFile, setShowFile] = useState(false);

  async function send(body: FormData | string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/briefings`, {
        method: "POST",
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the briefing");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const name = (title.trim() || `Notes ${new Date().toLocaleDateString()}`).slice(0, 120);
    if (await send(JSON.stringify({ filename: name, content_md: text }))) {
      setTitle("");
      setText("");
      router.refresh();
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (await send(form)) {
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
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
      <h2>Briefings</h2>
      <p className="muted">
        Notes the host reads before every episode: news, talking points, links, anything you want
        covered. Active briefings are used for every episode until you switch them off.
      </p>

      {owner ? (
        <form onSubmit={save}>
          <label htmlFor="briefing-title">Name (optional)</label>
          <input
            id="briefing-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. This week's market news"
          />
          <label htmlFor="briefing-text">Write or paste your notes</label>
          <textarea
            id="briefing-text"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an article, a list of headlines, or just a few sentences about what to talk about."
          />
          {error ? <p className="error">{error}</p> : null}
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="submit" disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save briefing"}
            </button>
            <button type="button" className="linklike" onClick={() => setShowFile((v) => !v)}>
              or add a file instead
            </button>
          </div>
          {showFile ? (
            <div style={{ marginTop: 10 }}>
              <input
                id="briefing"
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={() => void upload()}
              />
            </div>
          ) : null}
        </form>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {initialBriefings.length === 0 ? (
          <p className="muted">No briefings yet. Without one, episodes stay general.</p>
        ) : (
          initialBriefings.map((b) => (
            <div className="list-item" key={b.id}>
              <div>
                <strong>{b.filename}</strong>{" "}
                <span className={`tag ${b.is_active ? "active" : ""}`}>
                  {b.is_active ? "active" : "inactive"}
                </span>
                <details>
                  <summary className="muted">{b.content_md.length} characters · show</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{b.content_md}</pre>
                </details>
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
