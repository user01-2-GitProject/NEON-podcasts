import { expect, test } from "@playwright/test";

// We only assert the control renders; clicking it would start real Google OAuth.
test("login page renders the Google sign-in control", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /NEON Podcasts/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});
