import { expect, test } from "@playwright/test";

test("home page shows departments and search", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Shop by department" }).getByRole("link", { name: "Electrical" })).toBeVisible();
});

test("search tolerates typos and synonyms", async ({ page }) => {
  await page.goto("/search?q=fawcet");
  await expect(page.getByRole("link", { name: /Basin Mixer/ }).first()).toBeVisible();
});

test("category filters narrow the list", async ({ page }) => {
  await page.goto("/category/cables-wires");
  await page.getByRole("link", { name: /^2\.5 mm²/ }).first().click();
  await expect(page).toHaveURL(/attr%5Bcable_size%5D=2\.5|attr\[cable_size\]=2\.5/);
  await expect(page.getByText(/^1$/).first()).toBeVisible();
});

test("product page prices cable by the metre and by the roll", async ({ page }) => {
  await page.goto("/product/ducab-single-core-pvc-cable-450-750-v");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Buy more, pay less")).toBeVisible();
  await page.getByRole("button", { name: /^roll/ }).click();
  await expect(page.getByText(/per roll/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Add to cart — AED \d+\.\d\d/ })).toBeVisible();
});
