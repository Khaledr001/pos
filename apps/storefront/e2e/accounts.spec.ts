import { expect, test } from "@playwright/test";

test("a shopper registers, signs out and signs back in", async ({ page }) => {
  const email = `pw-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First name").fill("Play");
  await page.getByLabel("Last name").fill("Wright");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Sup3rSecret!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "Log out" }).first().click();
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Sup3rSecret!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
});
