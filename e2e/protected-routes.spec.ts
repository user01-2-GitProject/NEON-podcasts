import { expect, test } from "@playwright/test";

const protectedPaths = ["/", "/browse", "/settings", "/live"];

for (const path of protectedPaths) {
  test(`${path} redirects an unauthenticated visitor to login`, async ({ page }) => {
    await page.goto(path);

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(path);
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });
}
