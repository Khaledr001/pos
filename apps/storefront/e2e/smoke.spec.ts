import { expect, test } from "@playwright/test";

/** Against the platform's seeded demo tenant — see playwright.config.ts. */

test("home page shows the tenant's departments", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Shop by department" }).getByRole("link", { name: "Electrical" })).toBeVisible();
});

test("search tolerates typos in every word", async ({ page }) => {
  await page.goto("/search?q=schnieder%20swich");
  await expect(page.getByRole("link", { name: /Schneider Electric Vivace/ }).first()).toBeVisible();
});

test("a synonym finds the product", async ({ page }) => {
  await page.goto("/search?q=wire");
  await expect(page.getByRole("link", { name: /Flexible Copper Cable/ }).first()).toBeVisible();
});

test("product page shows the POS price with VAT, and stock per branch", async ({ page }) => {
  await page.goto("/product/schneider-electric-vivace-1-gang-1-way-switch");
  await expect(page.getByText(/Incl\. 5% VAT, AED\s[\d.]+ excl\. VAT/)).toBeVisible();
  await expect(page.getByText("In stock").first()).toBeVisible();
});
