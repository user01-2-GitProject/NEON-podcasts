"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FollowButton({ showId, initialFollowing }: { showId: string; initialFollowing: boolean }) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleFollow() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = following
        ? await fetch(`/api/subscriptions/${showId}`, { method: "DELETE" })
        : await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ show_id: showId }),
        });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Could not update your follows.");
      }
      setFollowing(!following);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className={following ? "btn secondary" : "btn"} type="button" disabled={pending} onClick={toggleFollow}>
        {pending ? "Updating..." : following ? "Following" : "Follow"}
      </button>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
