import { expect, test } from "@playwright/test";

test("la racine redirige vers une locale", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(fr|en)$/);
});

test("accueil /fr en français, bannière de simulation visible, lien vers /en", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Préparez, approuvez et programmez");
  await expect(page.getByTestId("simulation-banner")).toContainText("Mode simulation");
  const link = page.getByRole("link", { name: "English" });
  await expect(link).toHaveAttribute("href", "/en");
  await link.click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-CA");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Prepare, approve and schedule");
});

test("métadonnées localisées et liens hreflang réciproques", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator('link[rel="alternate"][hreflang="fr-CA"]')).toHaveAttribute("href", /\/fr$/);
  await expect(page.locator('link[rel="alternate"][hreflang="en-CA"]')).toHaveAttribute("href", /\/en$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Bilingual/);
});

test("aucune traduction manquante rendue", async ({ page }) => {
  for (const path of ["/fr", "/en"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("⟦");
  }
});

test("pas de défilement horizontal à 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/fr");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("sonde de santé sans secret", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok", env: "test", adapterMode: "fake" });
});
