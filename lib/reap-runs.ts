import { sql } from "@/lib/db";

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export async function reapStuckRuns(db: SqlFn = sql): Promise<void> {
  await db`
    update runs set
      status = 'failed',
      error = 'Generation timed out after 10 minutes',
      finished_at = now()
    where status = 'running' and scheduled_for is null
      and coalesce(heartbeat_at, started_at) < now() - interval '10 minutes'
  `;
}
