import { expect, test } from "@playwright/test";

const publicPaths = ["/login", "/privacy", "/terms"];

test("public pages render without console errors or page errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error on ${page.url()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    problems.push(`page error on ${page.url()}: ${error.message}`);
  });

  for (const path of publicPaths) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading").first()).toBeVisible();
    // Give the service worker registration (on window load) a chance to report.
    await page.waitForLoadState("networkidle");
  }

  expect(problems).toEqual([]);
});
