import { expect, test } from "@playwright/test";

test("a trade customer sees their trade price after logging in", async ({ page }) => {
  await page.goto("/login?next=/product/cosmoplast-ppr-pipe-pn20-4-m");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("contractor@al-lahiq.test");
  await page.getByLabel("Password").fill("Demo@12345");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/product\/cosmoplast-ppr-pipe-pn20-4-m/);
  await expect(page.getByText("Your trade price")).toBeVisible();
});

test("staff log in to the admin and see orders", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("orders@al-lahiq.test");
  await page.getByLabel("Password").fill("Demo@12345");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin\/orders/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/AL-\d{6}/).first()).toBeVisible();
});
