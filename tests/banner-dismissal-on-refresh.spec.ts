/**
 * Playwright test: data-quality banner disappears after a successful refresh.
 *
 * Scenario:
 *   1. Seed a report with airQualityEstimated=true so the amber banner shows.
 *      partialData=true ensures the "Refresh data" button renders without auth.
 *   2. Navigate to the report and assert the banner is visible.
 *   3. Intercept POST /refresh → 200 OK (bypasses auth + real API calls).
 *   4. Intercept the subsequent re-fetch GET → return clean data with both
 *      flags false (simulates a successful pipeline run clearing the flags).
 *   5. Click the refresh button.
 *   6. Assert the banner is no longer visible.
 *
 * Run with: npx playwright test tests/banner-dismissal-on-refresh.spec.ts
 */

import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawMetrics(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    crimeCount: 5,
    crimeTrend: "stable",
    safetySeverity: 10,
    safetyBreakdown: { violent: 1, theft: 1, asb: 1, vehicle: 1, drugs: 1 },
    transport: {
      trainDistance: 0.5,
      busStopDensity: 8,
      busStopCount: 3,
      stationCount: 1,
      hasMajorHub: false,
      commuteCityCenter: 25,
      commuteMajorHub: 20,
      busStops: [],
      stations: [],
    },
    amenities: {
      amenitiesCount: 4,
      diversityIndex: 2,
      totalCount: 4,
      topRatedPlaces: 1,
      nearestSupermarketDist: 0.6,
      list: [],
    },
    schools: {
      primaryRating: 80,
      secondaryRating: 80,
      count: 2,
      primaryList: [],
      secondaryList: [],
    },
    environment: {
      airQuality: {
        index: 2,
        level: "Low",
        description: "Air quality is satisfactory.",
        source: "Estimated from location",
        pollutants: [
          { name: "PM2.5", value: 8.0 },
          { name: "NO2", value: 20.0 },
        ],
      },
      noise: {
        day: 48,
        night: 36,
        level: "Quiet",
        sources: ["Quiet residential area"],
      },
      floodRisk: {
        likelihood: "Very Low",
        description: "Low flood risk.",
        activeAlerts: 0,
      },
    },
    councilTax: {
      estimatedBand: "C",
      lookupUrl: "https://www.tax.service.gov.uk/check-council-tax-band/search",
      source: "Estimated",
    },
    connectivity: { broadband: [], mobile: [] },
    evChargers: [],
    nearestPostcodes: [],
    neighbourhood: null,
    street: "Test Street",
    classification: "Test District",
    isScotland: false,
    crimeDataUnavailable: false,
    overpassFailed: false,
    airQualityEstimated: false,
    ...overrides,
  });
}

const BASE_SCORES = JSON.stringify({
  overall: 68,
  safety: 65,
  transport: 75,
  schools: 72,
  amenities: 68,
});

async function seedAssessment(
  pool: Pool,
  postcode: string,
  rawMetrics: string,
  partialData: boolean,
): Promise<string> {
  const token = randomUUID();
  await pool.query(
    `INSERT INTO assessments
       (postcode, lat, lng, raw_metrics, scores, partial_data, share_token)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [postcode, "51.5014", "-0.1419", rawMetrics, BASE_SCORES, partialData, token],
  );
  return token;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Report page — banner dismissal on refresh", () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("banner disappears after a successful refresh returns data with both flags cleared", async ({
    page,
  }) => {
    // 1. Seed report with airQualityEstimated=true (banner visible).
    //    partialData=true makes the "Refresh data" button appear without auth.
    const token = await seedAssessment(
      pool,
      "W1A 0AX",
      makeRawMetrics({ airQualityEstimated: true, overpassFailed: false }),
      true,
    );

    // Build the clean payload returned on the second GET (post-refresh).
    const cleanMetrics = JSON.parse(
      makeRawMetrics({ airQualityEstimated: false, overpassFailed: false }),
    );
    const cleanReport = {
      id: 999,
      shareToken: token,
      postcode: "W1A 0AX",
      lat: "51.5014",
      lng: "-0.1419",
      partialData: false,
      scores: JSON.parse(BASE_SCORES),
      rawMetrics: cleanMetrics,
      userId: null,
      createdAt: new Date().toISOString(),
      lastSearchedAt: new Date().toISOString(),
      lastRefreshedAt: new Date().toISOString(),
    };

    // 2. Track GET calls to serve different responses before and after refresh.
    let getCallCount = 0;

    // First GET → pass through to DB (seeded data; banner shows).
    // Subsequent GETs → return clean payload (banner should disappear).
    await page.route(
      (url) =>
        url.pathname === `/api/assess/token/${token}` &&
        !url.pathname.endsWith("/refresh"),
      async (route, request) => {
        if (request.method() !== "GET") {
          await route.continue();
          return;
        }
        getCallCount++;
        if (getCallCount === 1) {
          await route.continue();
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(cleanReport),
          });
        }
      },
    );

    // 3. Intercept POST /refresh → 200 OK (skips auth + external API calls).
    await page.route(
      (url) => url.pathname === `/api/assess/token/${token}/refresh`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(cleanReport),
        });
      },
    );

    // 4. Navigate and wait for the report to render fully.
    await page.goto(`/report/${token}`);
    await expect(
      page.locator('[data-testid="heading-environmental"]'),
    ).toBeVisible({ timeout: 30_000 });

    // 5. Confirm the banner is present before the refresh.
    const banner = page.locator('[data-testid="banner-data-quality"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Air quality");

    // 6. Confirm the refresh button is visible (partialData=true required).
    const refreshBtn = page.locator('[data-testid="button-refresh-report"]');
    await expect(refreshBtn).toBeVisible();

    // 7. Trigger the refresh and wait for React Query to re-fetch.
    await refreshBtn.click();

    // 8. After clean data arrives the banner must be gone from the DOM.
    await expect(banner).not.toBeVisible({ timeout: 15_000 });

    // Sanity-check: the GET was called more than once (re-fetch confirmed).
    expect(getCallCount).toBeGreaterThan(1);
  });
});
