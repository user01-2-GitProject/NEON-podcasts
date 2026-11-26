// Mobile Sentry init. Imported once from app/_layout.tsx.
// Expo inlines EXPO_PUBLIC_* at build time; release builds set NODE_ENV=production.
// @ts-ignore -- installed from package.json in real builds
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const sentryEnabled = process.env.NODE_ENV === "production" && Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    // Errors only: keep the free-tier 5k events/month budget for issues.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

export function captureMobileException(err: unknown, context?: string): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, { tags: { context: context ?? "mobile" } });
}
