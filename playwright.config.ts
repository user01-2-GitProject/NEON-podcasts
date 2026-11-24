import { defineConfig, devices } from "@playwright/test";

// Point PLAYWRIGHT_BASE_URL at an already-running preview/prod app to test that
// instead of booting a local build (the webServer is skipped in that case).
const localBaseURL = "http://127.0.0.1:3000";
const baseURL = (process.env.PLAYWRIGHT_BASE_URL ?? localBaseURL).replace(/\/+$/, "");

// All smoke paths are unauthenticated, so a dummy, local-only database URL is
// enough to boot Next.js. Nothing here writes to a database.
const bootEnv = {
  AUTH_SECRET: "smoke-test-dummy-secret-not-for-production-0123456789",
  AUTH_TRUST_HOST: "true",
  DATABASE_URL: "postgresql://dummy:dummy@127.0.0.1:5432/dummy",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  OWNER_EMAILS: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "off",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: bootEnv,
      },
});
