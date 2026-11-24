"use client";

import { useEffect, useState } from "react";

type Usage = {
  episodes_today: number;
  cost_cents_today: number;
  episode_limit: number | null;
  cost_limit: number | null;
  role: "owner" | "member";
};

// Today's generation usage against the daily caps (owners: unlimited).
export default function UsageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/me/usage", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Usage | null) => setUsage(data))
      .catch(() => setUsage(null));
  }, []);

  if (!usage) return null;
  const episodes = `${usage.episodes_today} episode${usage.episodes_today === 1 ? "" : "s"}`;
  return (
    <p className="muted" style={{ margin: "0 0 18px" }}>
      Generated in the last 24 hours: {episodes}
      {usage.episode_limit === null
        ? " · unlimited"
        : ` · ${Math.max(0, usage.episode_limit - usage.episodes_today)} of ${usage.episode_limit} left` +
          (usage.cost_limit === null
            ? ""
            : ` · $${(usage.cost_cents_today / 100).toFixed(2)} of $${(usage.cost_limit / 100).toFixed(2)} spent`)}
    </p>
  );
}
