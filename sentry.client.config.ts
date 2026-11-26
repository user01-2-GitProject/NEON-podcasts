// Browser-side Sentry init. Next 16 loads this through instrumentation-client.ts.
// Off in dev/test and whenever no DSN is configured.
// @ts-ignore -- installed from package.json in real builds
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (process.env.NODE_ENV === "production" && dsn) {
  Sentry.init({
    dsn,
    // Errors only: keep the free-tier 5k events/month budget for issues.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
