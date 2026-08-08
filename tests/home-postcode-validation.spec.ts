/**
 * End-to-end Playwright tests for the Home page postcode validation flow.
 *
 * All tests mock the backend proxy endpoint `/api/postcodes/:postcode/validate`
 * (not the external api.postcodes.io URL) because validation now goes through
 * the server-side proxy.
 *
 * Covers:
 *  1. Valid postcode — proxy returns 200 → modal appears and assessment starts.
 *  2. Invalid postcode — proxy returns 404 → "Postcode not found" toast shown,
 *     modal does NOT appear and /api/assess is NOT called.
 *  3. Network failure — proxy request aborts → "Validation failed" toast shown,
 *     modal does NOT appear and /api/assess is NOT called.
 *
 * Run with: npx playwright test tests/home-postcode-validation.spec.ts
 */

import { test, expect } from "@playwright/test";

const VALID_PC = "SW1A 1AA";
const INVALID_PC = "ZZ99 9ZZ";

test.describe("Home page — postcode validation via backend proxy", () => {
  test("valid postcode: proxy returns 200 → loading modal appears and assessment POST is made", async ({
    page,
  }) => {
    // Intercept the validation proxy and approve the postcode.
    await page.route("**/api/postcodes/*/validate", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ valid: true }) })
    );

    // Hold the /api/assess response until after the modal assertion so the page
    // cannot navigate away before we have a chance to assert the modal is visible.
    let releaseAssess!: () => void;
    const assessHeld = new Promise<void>((resolve) => {
      releaseAssess = resolve;
    });

    await page.route("**/api/assess", async (route) => {
      await assessHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ shareToken: "tok-test-123" }),
      });
    });

    await page.goto("/");
    await page.getByTestId("input-postcode").fill(VALID_PC);

    // Begin watching for the POST before clicking so we don't miss it.
    const assessRequestPromise = page.waitForRequest(
      (req) => req.url().includes("/api/assess") && req.method() === "POST",
      { timeout: 10_000 }
    );

    await page.getByTestId("button-analyse").click();

    // Wait for the POST to fire — this confirms the assessment was triggered.
    await assessRequestPromise;

    // The modal appears as soon as validation passes (before the response resolves).
    const modal = page.locator("[data-testid='loading-modal'], [role='dialog']").first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // No error toast should be visible.
    await expect(page.getByText("Postcode not found")).not.toBeVisible();
    await expect(page.getByText("Validation failed")).not.toBeVisible();

    // Let the held response resolve so the page can clean up.
    releaseAssess();
  });

  test("invalid postcode: proxy returns 404 → 'Postcode not found' toast, no modal, no /api/assess call", async ({
    page,
  }) => {
    const assessCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/assess") && req.method() === "POST") {
        assessCalls.push(req.url());
      }
    });

    // Intercept validation and reject the postcode.
    await page.route("**/api/postcodes/*/validate", (route) =>
      route.fulfill({
        status: 404,
        body: JSON.stringify({ error: "Postcode not found" }),
      })
    );

    await page.goto("/");

    await page.getByTestId("input-postcode").fill(INVALID_PC);
    await page.getByTestId("button-analyse").click();

    // A destructive toast should appear.
    const toast = page
      .locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']")
      .first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    const pageContent = await page.content();
    expect(pageContent).toContain("Postcode not found");

    // The loading modal must NOT appear.
    const modal = page.locator("[data-testid='loading-modal'], [role='dialog']").first();
    await expect(modal).not.toBeVisible();

    // No backend assessment call should have been made.
    expect(assessCalls.length).toBe(0);
  });

  test("network failure on proxy: 'Validation failed' toast, no modal, no /api/assess call", async ({
    page,
  }) => {
    const assessCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/assess") && req.method() === "POST") {
        assessCalls.push(req.url());
      }
    });

    // Abort the validation proxy request to simulate a network failure.
    await page.route("**/api/postcodes/*/validate", (route) => route.abort());

    await page.goto("/");

    await page.getByTestId("input-postcode").fill(VALID_PC);
    await page.getByTestId("button-analyse").click();

    // A destructive toast should appear.
    const toast = page
      .locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']")
      .first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    const pageContent = await page.content();
    expect(
      pageContent.includes("Validation failed") ||
        pageContent.includes("Unable to verify") ||
        pageContent.includes("connection"),
    ).toBeTruthy();

    // The loading modal must NOT appear.
    const modal = page.locator("[data-testid='loading-modal'], [role='dialog']").first();
    await expect(modal).not.toBeVisible();

    // No backend assessment call should have been made.
    expect(assessCalls.length).toBe(0);
  });
});
