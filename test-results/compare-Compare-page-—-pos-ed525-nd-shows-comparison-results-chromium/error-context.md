# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: compare.spec.ts >> Compare page — postcode validation >> valid pair of postcodes loads assessments and shows comparison results
- Location: tests/compare.spec.ts:26:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Liveability Showdown' })
Expected: visible
Timeout: 90000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 90000ms
  - waiting for getByRole('heading', { name: 'Liveability Showdown' })

```

```yaml
- region "Notifications (F8)":
  - list
- banner:
  - button:
    - img
  - heading "Compare Areas" [level=1]
  - link "Log in":
    - /url: /api/login
    - button "Log in":
      - img
      - text: Log in
- main:
  - text: Postcode 1
  - img
  - textbox "e.g. SW1A 1AA": SW1A 1AA
  - text: Postcode 2
  - img
  - textbox "e.g. E1 6AN": E1 6AN
  - button "Compare Areas":
    - img
    - text: Compare Areas
  - img
  - heading "Enter two postcodes to compare them side-by-side" [level=3]
  - paragraph: We'll analyse crime, transport, schools and more for both areas.
```

# Test source

```ts
  1   | /**
  2   |  * End-to-end Playwright tests for the Compare page postcode validation flow.
  3   |  *
  4   |  * Covers nine scenarios:
  5   |  *  1. Valid pair of postcodes → both assessments load and comparison results appear.
  6   |  *  2. One invalid postcode → error toast shown, no /api/assess call made.
  7   |  *  3. Both postcodes invalid simultaneously → "Postcodes not found" toast, no /api/assess call.
  8   |  *  4. Network failure during postcodes.io validation → graceful error toast, button re-enables.
  9   |  *  5. Same postcode in both fields → inline warning visible, Compare button disabled.
  10  |  *  6. Same postcode with different spacing/casing → warning still appears (normalisation).
  11  |  *  7. Correcting second field to a different postcode → warning disappears, button re-enables.
  12  |  *  8. pc2 invalid → toast names pc2 specifically, no /api/assess call, user stays on /compare.
  13  |  *  9. pc1 invalid → toast names pc1 specifically, no /api/assess call, user stays on /compare.
  14  |  *
  15  |  * Run with: npx playwright test tests/compare.spec.ts
  16  |  */
  17  | 
  18  | import { test, expect } from "@playwright/test";
  19  | 
  20  | const VALID_PC1 = "SW1A 1AA";
  21  | const VALID_PC2 = "E1 6AN";
  22  | const INVALID_PC = "ZZ99 9ZZ";
  23  | const INVALID_PC2 = "XX1 1XX";
  24  | 
  25  | test.describe("Compare page — postcode validation", () => {
  26  |   test("valid pair of postcodes loads assessments and shows comparison results", async ({
  27  |     page,
  28  |   }) => {
  29  |     await page.goto("/compare");
  30  | 
  31  |     await expect(
  32  |       page.getByRole("heading", { name: "Compare Areas" }),
  33  |     ).toBeVisible();
  34  | 
  35  |     await page
  36  |       .getByPlaceholder("e.g. SW1A 1AA")
  37  |       .fill(VALID_PC1);
  38  |     await page
  39  |       .getByPlaceholder("e.g. E1 6AN")
  40  |       .fill(VALID_PC2);
  41  | 
  42  |     await page.getByRole("button", { name: "Compare Areas" }).click();
  43  | 
  44  |     await expect(
  45  |       page.getByRole("heading", { name: "Liveability Showdown" }),
> 46  |     ).toBeVisible({ timeout: 90_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  47  | 
  48  |     await expect(page.getByRole("columnheader", { name: VALID_PC1 })).toBeVisible();
  49  |     await expect(page.getByRole("columnheader", { name: VALID_PC2 })).toBeVisible();
  50  | 
  51  |     const table = page.locator("table");
  52  |     await expect(table).toBeVisible();
  53  |     await expect(table.getByRole("columnheader", { name: "Category" })).toBeVisible();
  54  |   });
  55  | 
  56  |   test("one invalid postcode shows error toast and does not call /api/assess", async ({
  57  |     page,
  58  |   }) => {
  59  |     const assessCalls: string[] = [];
  60  |     page.on("request", (req) => {
  61  |       if (req.url().includes("/api/assess") && req.method() === "POST") {
  62  |         assessCalls.push(req.url());
  63  |       }
  64  |     });
  65  | 
  66  |     await page.goto("/compare");
  67  | 
  68  |     await page.getByPlaceholder("e.g. SW1A 1AA").fill(VALID_PC1);
  69  |     await page.getByPlaceholder("e.g. E1 6AN").fill(INVALID_PC);
  70  | 
  71  |     await page.getByRole("button", { name: "Compare Areas" }).click();
  72  | 
  73  |     const toastLocator = page.locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']").first();
  74  |     await expect(toastLocator).toBeVisible({ timeout: 15_000 });
  75  | 
  76  |     const pageContent = await page.content();
  77  |     expect(
  78  |       pageContent.includes("not found") ||
  79  |       pageContent.includes("not recognised") ||
  80  |       pageContent.includes("Postcode"),
  81  |     ).toBeTruthy();
  82  | 
  83  |     await expect(
  84  |       page.getByRole("heading", { name: "Liveability Showdown" }),
  85  |     ).not.toBeVisible();
  86  | 
  87  |     expect(assessCalls.length).toBe(0);
  88  |   });
  89  | 
  90  |   test("pc2 invalid: toast names the specific unrecognised postcode and user stays on /compare", async ({
  91  |     page,
  92  |   }) => {
  93  |     const assessCalls: string[] = [];
  94  |     page.on("request", (req) => {
  95  |       if (req.url().includes("/api/assess") && req.method() === "POST") {
  96  |         assessCalls.push(req.url());
  97  |       }
  98  |     });
  99  | 
  100 |     await page.goto("/compare");
  101 |     expect(new URL(page.url()).pathname).toBe("/compare");
  102 | 
  103 |     await page.getByPlaceholder("e.g. SW1A 1AA").fill(VALID_PC1);
  104 |     await page.getByPlaceholder("e.g. E1 6AN").fill(INVALID_PC);
  105 | 
  106 |     await page.getByRole("button", { name: "Compare Areas" }).click();
  107 | 
  108 |     // Wait for a toast to appear
  109 |     const toastLocator = page
  110 |       .locator("[data-radix-toast-viewport] li, [role='status'], [role='alert']")
  111 |       .first();
  112 |     await expect(toastLocator).toBeVisible({ timeout: 15_000 });
  113 | 
  114 |     // Toast title is the singular "Postcode not found" (not the both-invalid plural)
  115 |     const pageContent = await page.content();
  116 |     expect(pageContent).toContain("Postcode not found");
  117 | 
  118 |     // Description contains the specific invalid postcode that was rejected
  119 |     const normalisedInvalid = INVALID_PC.replace(/\s+/g, "").toUpperCase();
  120 |     expect(
  121 |       pageContent.includes(normalisedInvalid) || pageContent.includes(INVALID_PC),
  122 |     ).toBeTruthy();
  123 | 
  124 |     // Comparison results must NOT appear
  125 |     await expect(
  126 |       page.getByRole("heading", { name: "Liveability Showdown" }),
  127 |     ).not.toBeVisible();
  128 | 
  129 |     // User stays on /compare
  130 |     expect(new URL(page.url()).pathname).toBe("/compare");
  131 | 
  132 |     // No backend assessment call was made
  133 |     expect(assessCalls.length).toBe(0);
  134 |   });
  135 | 
  136 |   test("pc1 invalid: toast names the specific unrecognised postcode and user stays on /compare", async ({
  137 |     page,
  138 |   }) => {
  139 |     const assessCalls: string[] = [];
  140 |     page.on("request", (req) => {
  141 |       if (req.url().includes("/api/assess") && req.method() === "POST") {
  142 |         assessCalls.push(req.url());
  143 |       }
  144 |     });
  145 | 
  146 |     await page.goto("/compare");
```