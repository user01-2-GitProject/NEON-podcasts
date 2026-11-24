"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Owner control for a show's artwork URL (http/https; empty clears it).
// Saved through PATCH /api/shows/[id] { image_url }.
export default function ShowArtworkForm({ showId, initialImageUrl }: { showId: string; initialImageUrl: string | null }) {
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState(initialImageUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/shows/${showId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor="show-image-url">Artwork image URL</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="show-image-url"
          type="url"
          value={imageUrl}
          placeholder="https://example.com/cover.jpg"
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Save
        </button>
      </div>
      <p className="muted">
        Shown in the apps and on lock screens. Podcast apps expect a square JPEG or PNG, 1400–3000 px. Leave empty to
        use the network cover.
      </p>
      {saved ? <p className="muted">Saved.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </form>
  );
}
