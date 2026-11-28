import * as Sentry from "@sentry/nextjs";

export async function readJson<T>(res: Response, context: string): Promise<T> {
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("application/json")) {
    const raw = await res.text();
    if (type.includes("application/json")) {
      let message: string | undefined;
      try {
        const body = JSON.parse(raw) as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch {}
      if (message) throw new Error(message);
    }
    Sentry.captureException(new Error("Unexpected API response"), { extra: { context, status: res.status, contentType: type, response: raw.slice(0, 2000) } });
    throw new Error("Generation didn't finish — try again");
  }
  return res.json() as Promise<T>;
}

export async function pollRun(runId: string, fetcher = fetch, delay = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  for (let i = 0; i < 600; i++) {
    const run = await readJson<{ status: string; error?: string | null; episodeId?: string | null }>(await fetcher(`/api/runs/${runId}`), "run-status");
    if (run.status !== "running") return run;
    await delay(3000);
  }
  throw new Error("Generation is taking longer than expected. Check back in a few minutes.");
}

export async function makeEpisodeAudio(
  episodeId: string,
  runId: string,
  fetcher = fetch,
  delay = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let i = 0; i < 600; i++) {
    const res = await fetcher(`/api/episodes/${episodeId}/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const result = await readJson<{ complete: boolean }>(res, "make-episode-audio");
    if (typeof result.complete !== "boolean") throw new Error("Audio generation didn't finish — try again");
    if (result.complete) return;
    await delay(3000);
  }
  throw new Error("Audio is taking longer than expected. Check back in a few minutes.");
}
