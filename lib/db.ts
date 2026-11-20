import { neon } from "@neondatabase/serverless";

// A single tagged-template SQL client reused across the app.
// `neon()` is a serverless HTTP driver — safe to call per request on Vercel.
let client: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

// Convenience passthrough so callers can `import { sql } from "@/lib/db"`.
// Forwards tagged-template calls to the lazily-created client.
export const sql = ((...args: Parameters<ReturnType<typeof neon>>) =>
  (getSql() as (...a: unknown[]) => unknown)(...args)) as ReturnType<typeof neon>;
