"use client";

// The show's cover, for owners: upload your own square picture (checked
// against Apple's rules on the server), or go back to the free cover made
// from the show's name.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ShowArtworkForm({ showId, initialImageUrl }: { showId: string; initialImageUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const uploaded = !!initialImageUrl && initialImageUrl.startsWith(`/art/${showId}?u=`);

  async function send(method: "POST" | "DELETE", file?: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      let body: FormData | undefined;
      if (file) {
        body = new FormData();
        body.append("file", file);
      }
      const res = await fetch(`/api/shows/${showId}/artwork`, { method, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      setDone(method === "POST" ? "New cover saved. It's in your feed now." : "Back to the free cover.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted">
        {uploaded ? "This show uses the cover you uploaded." : "Your cover is made for you from the show's name."} Apple
        wants a square JPG or PNG, 1400 to 3000 pixels wide.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send("POST", f);
        }}
      />
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Saving…" : uploaded ? "Upload a different cover" : "Upload my own cover"}
      </button>{" "}
      {uploaded ? (
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void send("DELETE")}>
          Use the free cover
        </button>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {done ? <p className="muted">{done}</p> : null}
    </div>
  );
}
