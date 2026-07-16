import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/health/version", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "0.1.0-staging.1",
        environment: "staging"
      })
    });
  });
});

test("presenta un único acceso QA claramente marcado como staging", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("STAGING · NO PRODUCTIVO")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validación segura de acceso" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión con Google" })).toBeVisible();
  await expect(page.getByText("0.1.0-staging.1")).toBeVisible();
  await expect(page.getByText(/Shary|Debby|Lía|Smith/i)).toHaveCount(0);
});

test("no desborda horizontalmente en escritorio ni móvil", async ({ page }) => {
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
