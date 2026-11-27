import { sql } from "@/lib/db";

export async function runGenerationInBackground(runId: string, generate: () => Promise<unknown>): Promise<void> {
  try {
    await generate();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[generation] run ${runId} failed: ${reason}`);
    await sql`
      update runs set status = 'failed', error = ${reason}, finished_at = now()
      where id = ${runId} and status = 'running'
    `;
  }
}
