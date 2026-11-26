// Server-side Sentry init. Loaded by instrumentation.ts in the Node.js runtime.
// Stay off outside production and until a DSN is configured; dev/test runs make
// no network calls at all.
// @ts-ignore -- installed from package.json in real builds
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
export const sentryEnabled = process.env.NODE_ENV === "production" && Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    // Errors only: keep the free-tier 5k events/month budget for issues.
    tracesSampleRate: 0,
  });
}

// Route Handlers catch their own errors so they can return friendly messages.
// Call this from those catch blocks to keep the original error in Sentry.
export function captureServerException(err: unknown, context?: string): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, { tags: { context: context ?? "server" } });
}
