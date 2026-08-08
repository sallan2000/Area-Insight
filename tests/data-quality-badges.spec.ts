/**
 * End-to-end Playwright tests for data-quality badge and banner rendering.
 *
 * Three complementary scenarios:
 *
 * 1. DB-seeded: airQualityEstimated=true  → Air Quality card shows amber "Estimated"
 *    badge, amber monitoring-station notice, and the global data-quality banner.
 *
 * 2. DB-seeded: overpassFailed=true       → Noise card shows "map data unavailable"
 *    warning and the global banner; DEFRA live badge is shown.
 *
 * 3. Full-pipeline: triggers a real POST /api/assess via the Home page UI, then
 *    intercepts the subsequent GET /api/assess/token/* to inject
 *    airQualityEstimated=true (simulating DEFRA unavailability) and
 *    overpassFailed=true (simulating an Overpass outage).  This confirms that
 *    when the server pipeline sets either flag the Report page renders both
 *    the global banner and the card-level indicators.
 *
 * Run with: npx playwright test tests/data-quality-badges.spec.ts
 */

import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Minimal rawMetrics factory
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

// ---------------------------------------------------------------------------
// DB helper: insert one assessment row and return its share_token
// ---------------------------------------------------------------------------

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
// Test suite
// ---------------------------------------------------------------------------

test.describe("Report page — data quality badges and banners", () => {
  let pool: Pool;

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool.end();
  });

  // -------------------------------------------------------------------------
  // Test 1 (DB-seeded rendering): airQualityEstimated = true
  // -------------------------------------------------------------------------
  test("shows amber Estimated badge and top banner when airQualityEstimated is true", async ({
    page,
  }) => {
    const token = await seedAssessment(
      pool,
      "SW1A 1AA",
      makeRawMetrics({ airQualityEstimated: true, overpassFailed: false }),
      false,
    );

    await page.goto(`/report/${token}`);

    await expect(
      page.locator('[data-testid="heading-environmental"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Global data-quality banner present, mentioning air quality
    const banner = page.locator('[data-testid="banner-data-quality"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Air quality");

    // Amber "Estimated" pill badge
    await expect(
      page.locator('[data-testid="badge-air-quality-estimated"]'),
    ).toBeVisible();

    // Amber monitoring-station notice
    await expect(
      page.locator('[data-testid="notice-air-quality-estimated"]'),
    ).toBeVisible();

    // DEFRA live badge must NOT be shown
    await expect(
      page.locator('[data-testid="badge-air-quality-live"]'),
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 2 (DB-seeded rendering): overpassFailed = true
  // -------------------------------------------------------------------------
  test("shows noise card warning and top banner when overpassFailed is true", async ({
    page,
  }) => {
    const token = await seedAssessment(
      pool,
      "EC1A 1BB",
      makeRawMetrics({ overpassFailed: true, airQualityEstimated: false }),
      true,
    );

    await page.goto(`/report/${token}`);

    await expect(
      page.locator('[data-testid="heading-environmental"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Global data-quality banner present, mentioning map data
    const banner = page.locator('[data-testid="banner-data-quality"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Map data");

    // Noise card overpass-failed warning
    const noiseCard = page.locator('[data-testid="card-noise"]');
    await expect(noiseCard).toBeVisible();
    await expect(
      noiseCard.locator('[data-testid="notice-overpass-failed-noise"]'),
    ).toBeVisible();

    // Air quality "Estimated" badge absent (airQualityEstimated=false)
    await expect(
      page.locator('[data-testid="badge-air-quality-estimated"]'),
    ).not.toBeVisible();

    // DEFRA live badge present (airQualityEstimated=false)
    await expect(
      page.locator('[data-testid="badge-air-quality-live"]'),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 3 (full-pipeline): triggers a real /api/assess POST via the Home page,
  // then intercepts the report's GET to inject both failure flags — simulating
  // the response the server would return when DEFRA and Overpass both fail.
  // Verifies that the Report page renders all expected indicators for combined
  // DEFRA + Overpass failure coming from the server pipeline.
  // -------------------------------------------------------------------------
  test("full pipeline: Report page renders all badges when server returns both failure flags", async ({
    page,
  }) => {
    // Intercept the report GET to inject both failure flags, simulating what
    // the server stores when prefetchedAirQuality===null and elements.length===0.
    let intercepted = false;
    await page.route("**/api/assess/token/**", async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      // Mirror the server's rawMetrics shape, overriding only the two flags.
      const patchedBody = {
        ...body,
        rawMetrics: {
          ...body.rawMetrics,
          airQualityEstimated: true,  // as if prefetchedAirQuality === null
          overpassFailed: true,       // as if elements.length === 0
        },
        partialData: true,
      };

      intercepted = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(patchedBody),
      });
    });

    // Submit a postcode via the home page to trigger a real server pipeline run
    await page.goto("/");
    await page.locator('[data-testid="input-postcode"]').fill("W1A 1AA");
    await page.locator('[data-testid="button-analyse"]').click();

    // Wait for the report page to load (assessment creation can take up to 90 s)
    await expect(
      page.locator('[data-testid="heading-environmental"]'),
    ).toBeVisible({ timeout: 90_000 });

    // Confirm the route interceptor fired (proving we exercised the pipeline)
    expect(intercepted).toBe(true);

    // Global banner must appear (both flags are set)
    const banner = page.locator('[data-testid="banner-data-quality"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Air quality");
    await expect(banner).toContainText("Map data");

    // Air Quality card: Estimated badge and notice present; live badge absent
    await expect(
      page.locator('[data-testid="badge-air-quality-estimated"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="notice-air-quality-estimated"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="badge-air-quality-live"]'),
    ).not.toBeVisible();

    // Noise card: overpass-failed warning present
    const noiseCard = page.locator('[data-testid="card-noise"]');
    await expect(noiseCard).toBeVisible();
    await expect(
      noiseCard.locator('[data-testid="notice-overpass-failed-noise"]'),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 4 (failure path): banner stays visible when the refresh POST fails
  // -------------------------------------------------------------------------
  test("banner stays visible and error toast appears when refresh returns an error", async ({
    page,
  }) => {
    // Seed with airQualityEstimated=true so the banner is shown.
    // partialData=true so the Refresh button is rendered (unauthenticated path).
    const token = await seedAssessment(
      pool,
      "W1B 1AA",
      makeRawMetrics({ airQualityEstimated: true, overpassFailed: false }),
      true,
    );

    await page.goto(`/report/${token}`);

    await expect(
      page.locator('[data-testid="heading-environmental"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Banner must be present before we attempt the refresh
    const banner = page.locator('[data-testid="banner-data-quality"]');
    await expect(banner).toBeVisible();

    // Intercept the refresh POST and force a 500 error
    await page.route(`**/api/assess/token/${token}/refresh`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Internal server error" }),
      }),
    );

    // Click the refresh button
    await page.locator('[data-testid="button-refresh-report"]').click();

    // Wait for the error toast title — its appearance proves the 500 response was
    // received and handleRefresh's catch block has fully executed.
    const toastTitle = page
      .locator('[data-component-name="ToastTitle"]')
      .filter({ hasText: "Refresh failed" })
      .first();
    await expect(toastTitle).toBeVisible({ timeout: 10_000 });

    // NOW assert the banner: after the failure path ran, it must STILL be visible.
    // A regression that hides the banner on any error response would fail here.
    await expect(banner).toBeVisible();
  });
});
