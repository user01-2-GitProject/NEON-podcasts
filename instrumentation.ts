// Next.js loads this at server startup. Only the Node.js runtime is used here
// (generation routes declare `runtime = "nodejs"`).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}
