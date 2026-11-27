import * as Sentry from "@sentry/nextjs";

export async function readJson<T>(res: Response, context: string): Promise<T> {
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("application/json")) {
    const raw = await res.text();
    Sentry.captureException(new Error("Unexpected API response"), { extra: { context, status: res.status, contentType: type, response: raw.slice(0, 2000) } });
    throw new Error("Generation didn't finish — try again");
  }
  return res.json() as Promise<T>;
}

export async function pollRun(runId: string, fetcher = fetch, delay = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  for (let i = 0; i < 600; i++) {
    const run = await readJson<{ status: string; error?: string | null }>(await fetcher(`/api/runs/${runId}`), "run-status");
    if (run.status !== "running") return run;
    await delay(3000);
  }
  throw new Error("Generation is taking longer than expected. Check back in a few minutes.");
}
