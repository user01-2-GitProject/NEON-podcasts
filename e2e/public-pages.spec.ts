import { expect, test } from "@playwright/test";

const publicPages = [
  { path: "/privacy", heading: "Privacy Policy", text: /We do not sell your personal information/ },
  { path: "/terms", heading: "Terms of Service", text: /You are responsible for the content/ },
];

for (const { path, heading, text } of publicPages) {
  test(`${path} returns 200 with real content and does not redirect`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();
  });
}
