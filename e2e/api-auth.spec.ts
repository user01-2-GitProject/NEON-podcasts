import { expect, test } from "@playwright/test";

// No bearer token and no session cookie: middleware must reject before any DB work.
test("GET /api/live/sessions is 401 without auth", async ({ request }) => {
  const response = await request.get("/api/live/sessions");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "Please sign in first." });
});
