import { expect, test, type Page } from "@playwright/test";

async function addToCart(page: Page, slug: string) {
  await page.goto(`/product/${slug}`);
  await page.waitForLoadState("networkidle"); // hydrated, so the click is handled
  await page.getByRole("button", { name: /^Add to cart/ }).click();
  await expect(page.getByText(/added to your cart/)).toBeVisible();
}

async function fillContact(page: Page) {
  await page.getByLabel("Full name").fill("Playwright Buyer");
  await page.getByLabel("Email").fill("playwright@example.com");
  await page.getByLabel("Mobile").fill("+971501234567");
}

test("guest buys a tap with cash on delivery to Dubai", async ({ page }) => {
  await addToCart(page, "milano-basin-pillar-tap");
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await page.getByRole("link", { name: "Go to checkout" }).click();

  await fillContact(page);
  await page.getByLabel("Area").fill("Al Barsha 2");
  await page.getByLabel("Street").fill("Street 23");
  await expect(page.getByText(/Delivery to Dubai/)).toBeVisible();
  await page.getByLabel(/Cash on delivery/).check();
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/checkout\/success\?order=/);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await expect(page.getByText(/AL-\d{6}/)).toBeVisible();
});

test("card payment for store pickup goes through the payment page", async ({ page }) => {
  await addToCart(page, "grohe-eurosmart-basin-mixer");
  await page.goto("/checkout");
  await page.waitForLoadState("networkidle");
  await fillContact(page);
  await page.getByLabel(/Store pickup/).check();
  await expect(page.getByLabel("Pickup time")).toBeVisible();
  await page.getByLabel(/Credit \/ debit card/).check();
  await page.getByRole("button", { name: "Place order and pay" }).click();

  await expect(page).toHaveURL(/\/checkout\/pay\/dev/);
  await page.getByRole("button", { name: "Pay now" }).click();
  await expect(page).toHaveURL(/\/checkout\/success/);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
});

test("heavy items can only be collected from the store", async ({ page }) => {
  await addToCart(page, "emirates-cement-opc-42-5n-50-kg-bag");
  await page.goto("/checkout");
  await expect(page.getByLabel(/Courier delivery/)).toBeDisabled();
  await expect(page.getByLabel(/Store pickup/)).toBeChecked();
});
