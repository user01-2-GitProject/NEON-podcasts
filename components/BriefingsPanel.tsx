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
  const [link, setLink] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function send(body: FormData | string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/shows/${showId}/briefings`, {
        method: "POST",
        ...(typeof body === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that. Try again.");
      setNote(data.truncated ? "Saved. It was very long, so only the first part will be used." : "Saved.");
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

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    if (await send(JSON.stringify({ url: link.trim() }))) {
      setLink("");
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
      <h2>Source material</h2>
      <p className="muted">
        What the host should talk about: news, notes, articles, talking points. Add as much or as little as you
        like. With none, episodes stay general.
      </p>

      {owner ? (
        <>
          <form onSubmit={save}>
            <label htmlFor="briefing-text">Paste or type notes</label>
            <textarea
              id="briefing-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. GameStop up 12% on rumors of a buyback. Fed meets Wednesday. Talk about the Reddit thread about…"
            />
            <label htmlFor="briefing-title">Give it a name (optional)</label>
            <input
              id="briefing-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. This week's market news"
            />
            <div style={{ marginTop: 10 }}>
              <button type="submit" disabled={busy || !text.trim()}>
                {busy ? "Saving…" : "Save notes"}
              </button>
            </div>
          </form>

          <form onSubmit={addLink} style={{ marginTop: 16 }}>
            <label htmlFor="briefing-link">Or add a link to an article</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="briefing-link"
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…"
              />
              <button type="submit" disabled={busy || !link.trim()}>
                Add
              </button>
            </div>
          </form>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="briefing">Or upload a document (PDF, Word or text)</label>
            <input
              id="briefing"
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html"
              onChange={() => void upload()}
              disabled={busy}
            />
          </div>
          {busy ? <p className="muted">Working on it…</p> : null}
          {note && !error ? <p className="muted">{note}</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
        </>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {initialBriefings.length === 0 ? (
          <p className="muted">Nothing added yet.</p>
        ) : (
          initialBriefings.map((b) => (
            <div className="list-item" key={b.id}>
              <div>
                <strong>{b.filename}</strong>{" "}
                <span className={`tag ${b.is_active ? "active" : ""}`}>
                  {b.is_active ? "in use" : "paused"}
                </span>
                <details>
                  <summary className="muted">Show text</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{b.content_md}</pre>
                </details>
              </div>
              {owner ? <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary" onClick={() => toggle(b)}>
                  {b.is_active ? "Pause" : "Use again"}
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
