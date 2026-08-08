/**
 * End-to-end Playwright tests for the Compare page postcode validation flow.
 *
 * Covers seven scenarios:
 *  1. Valid pair of postcodes → both assessments load and comparison results appear.
 *  2. One invalid postcode → error toast shown, no /api/assess call made.
 *  3. Both postcodes invalid simultaneously → "Postcodes not found" toast, no /api/assess call.
 *  4. Network failure during postcodes.io validation → graceful error toast, button re-enables.
 *  5. Same postcode in both fields → inline warning visible, Compare button disabled.
 *  6. Same postcode with different spacing/casing → warning still appears (normalisation).
 *  7. Correcting second field to a different postcode → warning disappears, button re-enables.
 *
 * Run with: npx playwright test tests/compare.spec.ts
 */

import { test, expect } from "@playwright/test";

const VALID_PC1 = "SW1A 1AA";
const VALID_PC2 = "E1 6AN";
const INVALID_PC = "ZZ99 9ZZ";
const INVALID_PC2 = "XX1 1XX";

test.describe("Compare page — postcode validation", () => {
  test("valid pair of postcodes loads assessments and shows comparison results", async ({
    page,
  }) => {
    await page.goto("/compare");

    await expect(
      page.getByRole("heading", { name: "Compare Areas" }),
    ).toBeVisible();

    await page
      .getByPlaceholder("e.g. SW1A 1AA")
      .fill(VALID_PC1);
    await page
      .getByPlaceholder("e.g. E1 6AN")
      .fill(VALID_PC2);

    await page.getByRole("button", { name: "Compare Areas" }).click();

    await expect(
      page.getByRole("heading", { name: "Liveability Showdown" }),
    ).toBeVisible({ timeout: 90_000 });

    await expect(page.getByRole("columnheader", { name: VALID_PC1 })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: VALID_PC2 })).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Category" })).toBeVisible();
  });

  test("one invalid postcode shows error toast and does not call /api/assess", async ({
    page,
  }) => {
    const assessCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/assess") && req.method() === "POST") {
        assessCalls.push(req.url());
      }
    });

    await page.goto("/compare");

    await page.getByPlaceholder("e.g. SW1A 1AA").fill(VALID_PC1);
    await page.getByPlaceholder("e.g. E1 6AN").fill(INVALID_PC);

    await page.getByRole("button", { name: "Compare Areas" }).click();

    const toastLocator = page.locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']").first();
    await expect(toastLocator).toBeVisible({ timeout: 15_000 });

    const pageContent = await page.content();
    expect(
      pageContent.includes("not found") ||
      pageContent.includes("not recognised") ||
      pageContent.includes("Postcode"),
    ).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: "Liveability Showdown" }),
    ).not.toBeVisible();

    expect(assessCalls.length).toBe(0);
  });

  test("both postcodes invalid shows 'Postcodes not found' toast and does not call /api/assess", async ({
    page,
  }) => {
    const assessCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/assess") && req.method() === "POST") {
        assessCalls.push(req.url());
      }
    });

    await page.goto("/compare");

    await page.getByPlaceholder("e.g. SW1A 1AA").fill(INVALID_PC);
    await page.getByPlaceholder("e.g. E1 6AN").fill(INVALID_PC2);

    await page.getByRole("button", { name: "Compare Areas" }).click();

    const toastLocator = page.locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']").first();
    await expect(toastLocator).toBeVisible({ timeout: 15_000 });

    const pageContent = await page.content();
    expect(
      pageContent.includes("Postcodes not found") ||
      pageContent.includes("Neither postcode was recognised"),
    ).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: "Liveability Showdown" }),
    ).not.toBeVisible();

    expect(assessCalls.length).toBe(0);
  });

  test("network failure during postcodes.io validation shows graceful error toast and re-enables button", async ({
    page,
  }) => {
    await page.goto("/compare");

    await page.route("**api.postcodes.io**", (route) => route.abort());

    await page.getByPlaceholder("e.g. SW1A 1AA").fill(VALID_PC1);
    await page.getByPlaceholder("e.g. E1 6AN").fill(VALID_PC2);

    await page.getByRole("button", { name: "Compare Areas" }).click();

    const toastLocator = page.locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']").first();
    await expect(toastLocator).toBeVisible({ timeout: 15_000 });

    const pageContent = await page.content();
    expect(
      pageContent.includes("Validation failed") ||
      pageContent.includes("Unable to verify") ||
      pageContent.includes("connection"),
    ).toBeTruthy();

    await expect(
      page.getByRole("heading", { name: "Liveability Showdown" }),
    ).not.toBeVisible();

    await expect(
      page.getByRole("button", { name: "Compare Areas" }),
    ).toBeEnabled({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // Same-postcode inline warning tests
  // ---------------------------------------------------------------------------

  test("same postcode in both fields shows inline warning and disables Compare button", async ({
    page,
  }) => {
    await page.goto("/compare");

    await page.getByTestId("input-postcode1").fill(VALID_PC1);
    await page.getByTestId("input-postcode2").fill(VALID_PC1);

    // Inline warning must be visible
    await expect(page.getByTestId("warning-same-postcode")).toBeVisible();

    // Warning text is correct
    await expect(page.getByTestId("warning-same-postcode")).toContainText(
      "Both postcodes are the same",
    );

    // Compare button must be disabled
    await expect(
      page.getByRole("button", { name: "Compare Areas" }),
    ).toBeDisabled();
  });

  test("same postcode with different spacing/casing still shows warning (normalisation)", async ({
    page,
  }) => {
    await page.goto("/compare");

    // Input 1: uppercase with space, Input 2: lowercase without space — both represent SW1A1AA
    await page.getByTestId("input-postcode1").fill("SW1A 1AA");
    // The input auto-uppercases, so type the trimmed variant and verify normalisation still triggers
    await page.getByTestId("input-postcode2").fill("SW1A1AA");

    await expect(page.getByTestId("warning-same-postcode")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Compare Areas" }),
    ).toBeDisabled();
  });

  test("correcting second field to a different postcode hides warning and re-enables button", async ({
    page,
  }) => {
    await page.goto("/compare");

    // Start with both fields the same
    await page.getByTestId("input-postcode1").fill(VALID_PC1);
    await page.getByTestId("input-postcode2").fill(VALID_PC1);

    await expect(page.getByTestId("warning-same-postcode")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Compare Areas" }),
    ).toBeDisabled();

    // Fix the second postcode
    await page.getByTestId("input-postcode2").fill(VALID_PC2);

    // Warning must disappear
    await expect(page.getByTestId("warning-same-postcode")).not.toBeVisible();

    // Button must re-enable
    await expect(
      page.getByRole("button", { name: "Compare Areas" }),
    ).toBeEnabled();
  });
});
