"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Owner tools for the show's canonical spec: export it as show.md, or replace
// the show's settings, style guide and pronunciations from an edited show.md.
export default function ShowSpecPanel({ showId }: { showId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErrors([]);
    setNotice(null);
    try {
      const res = await fetch(`/api/shows/${showId}/spec`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: await file.text() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.errors || [data.error || "Update failed"]);
        return;
      }
      setNotice(`Updated from ${file.name}.`);
      router.refresh();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>show.md</h2>
      <p className="muted">
        Download this show as a show.md, edit it, and upload it to update the show&apos;s settings, style guide and
        pronunciations in one go. Briefings and episodes aren&apos;t touched.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {errors.length ? (
        <ul className="error">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="muted">✅ {notice}</p> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <a className="btn secondary" href={`/api/shows/${showId}/spec`}>
          Download show.md
        </a>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Updating…" : "Update from show.md"}
        </button>
      </div>
    </div>
  );
}
