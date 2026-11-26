const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Purely static checks: these tests never import the Sentry SDKs, never make a
// network request, and do not require node_modules to contain @sentry/*.
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));

test("Sentry SDKs are declared for web and mobile", () => {
  assert.match(json("package.json").dependencies["@sentry/nextjs"], /^\^/);
  assert.match(json("mobile/package.json").dependencies["@sentry/react-native"], /^\^/);
});

test("web configs init only in production with a DSN from the env", () => {
  for (const file of ["sentry.server.config.ts", "sentry.client.config.ts"]) {
    const src = read(file);
    assert.match(src, /process\.env\.NODE_ENV === "production"/, `${file}: production gate`);
    assert.match(src, /process\.env\.NEXT_PUBLIC_SENTRY_DSN/, `${file}: DSN env name`);
    assert.match(src, /Sentry\.init\(/, `${file}: init call`);
    assert.ok(
      src.indexOf('NODE_ENV === "production"') < src.indexOf("Sentry.init("),
      `${file}: init must come after the production gate`,
    );
    assert.doesNotMatch(src, /dsn:\s*"https:/, `${file}: no hardcoded DSN`);
  }
  // The server config exports a reusable, equally gated helper for route handlers.
  const server = read("sentry.server.config.ts");
  assert.match(server, /sentryEnabled = process\.env\.NODE_ENV === "production" && Boolean\(dsn\)/);
  assert.match(server, /if \(!sentryEnabled\) return;/);
  assert.match(server, /Sentry\.captureException\(err, \{ tags: \{ context:/);
});

test("Next 16 instrumentation loads both web configs", () => {
  const server = read("instrumentation.ts");
  assert.match(server, /NEXT_RUNTIME === "nodejs"/);
  assert.match(server, /import\("\.\/sentry\.server\.config"\)/);
  assert.match(read("instrumentation-client.ts"), /import "\.\/sentry\.client\.config"/);
});

test("env examples use empty DSN placeholders, never a real DSN", () => {
  const web = read(".env.example");
  assert.match(web, /^NEXT_PUBLIC_SENTRY_DSN=""$/m);
  assert.doesNotMatch(web, /ingest\.sentry\.io/);
  const mobile = read("mobile/.env.example");
  assert.match(mobile, /^EXPO_PUBLIC_SENTRY_DSN=""$/m);
  assert.doesNotMatch(mobile, /ingest\.sentry\.io/);
});

test("mobile init is production-only and wired into the root layout", () => {
  const src = read("mobile/sentry.ts");
  assert.match(src, /NODE_ENV === "production"/);
  assert.match(src, /EXPO_PUBLIC_SENTRY_DSN/);
  assert.match(src, /Sentry\.init\(/);
  assert.match(src, /if \(!sentryEnabled\) return;/);
  assert.match(read("mobile/app/_layout.tsx"), /import "\.\.\/sentry"/);
});

test("generate route captures thrown errors before returning the friendly response", () => {
  const src = read("app/api/shows/[id]/generate/route.ts");
  assert.match(src, /import \{ captureServerException \} from "@\/sentry\.server\.config"/);
  const caught = src.match(/catch \(err\) \{([\s\S]*?)\n  \}/);
  assert.ok(caught, "generate route has a catch block");
  assert.match(caught[1], /sanitizeError\(err, "generateEpisode"\)/);
  assert.match(caught[1], /captureServerException\(err, "generateEpisode"\)/);
  assert.match(caught[1], /friendlyGenerateError\(err\)/);
  assert.match(caught[1], /NextResponse\.json\(\{ error: message \}, \{ status \}\)/);
});
