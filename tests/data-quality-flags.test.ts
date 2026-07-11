/**
 * Integration tests: data-quality flags set correctly under upstream API failures.
 *
 * These tests exercise the REAL Express route handler from server/routes.ts.
 * global.fetch is patched to force specific upstream failures:
 *
 *  1. DEFRA UK-AIR returns an empty station list  → prefetchedAirQuality === null
 *     → rawMetrics.airQualityEstimated must be stored as true
 *
 *  2. All Overpass mirrors return empty elements  → Promise.any() rejects, returns []
 *     → rawMetrics.overpassFailed must be stored as true
 *
 *  3. Both failures together                      → both flags stored as true
 *
 * Storage is NOT mocked — the real DB is used so we can assert the persisted
 * rawMetrics.  Inserted rows are cleaned up in afterEach.
 *
 * Run with: npx tsx --test tests/data-quality-flags.test.ts
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";

import { registerRoutes } from "../server/routes.ts";

// ---------------------------------------------------------------------------
// Valid postcodes.io geocoding response for SW1A 1AA
// ---------------------------------------------------------------------------
const POSTCODE = "SW1A 1AA";
const GEOCODE_RESPONSE = {
  status: 200,
  result: {
    postcode: "SW1A 1AA",
    latitude: 51.5014,
    longitude: -0.1419,
    country: "England",
    admin_district: "City of Westminster",
    parish: "Westminster",
    admin_ward: "St James's",
    outcode: "SW1A",
    status: "live",
    codes: {
      admin_district: "E09000033",
      lsoa: "E01004712",
    },
  },
};

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type FetchOverrides = {
  overpassEmpty?: boolean;   // all mirrors return empty elements → overpassFailed
  defraEmpty?: boolean;      // DEFRA returns empty stations list → airQualityEstimated
};

/**
 * Returns a fetch mock that:
 * - Answers postcodes.io with valid geocoding data
 * - Optionally returns empty Overpass elements (causing all mirrors to throw)
 * - Optionally returns empty DEFRA stations (causing null air quality)
 * - Returns empty/ok responses for all other endpoints (police, flood, ofcom, etc.)
 */
function buildFetchMock(overrides: FetchOverrides = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Geocoding — required for the assessment to proceed
    if (url.includes("api.postcodes.io/postcodes")) {
      return new Response(JSON.stringify(GEOCODE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Overpass mirrors
    if (
      url.includes("overpass-api.de") ||
      url.includes("overpass.kumi.systems") ||
      url.includes("overpass.osm.ch")
    ) {
      if (overrides.overpassEmpty) {
        // Return empty elements — the fetchFromOverpass logic throws when
        // elements.length === 0, causing all mirrors to fail → overpassFailed=true
        return new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Return minimal non-empty elements so the flag stays false
      return new Response(
        JSON.stringify({ elements: [{ type: "node", id: 1, lat: 51.5014, lon: -0.1419, tags: { highway: "bus_stop", name: "Test Stop" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // DEFRA UK-AIR stations endpoint
    if (url.includes("uk-air.defra.gov.uk") && url.includes("stations")) {
      if (overrides.defraEmpty) {
        // Empty stations list → getAirQualityFromDefra returns null → airQualityEstimated=true
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Return a station that has no pollutant data (no timeseries with lastValue)
      // This also triggers null — but we mark defraEmpty=false as "live" only when we
      // want the flag false; for simplicity we use empty-stations for the false case too.
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Police API — return empty (no crimes)
    if (url.includes("data.police.uk")) {
      if (url.includes("locate-neighbourhood")) {
        return new Response(JSON.stringify(null), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Environment Agency flood API — return empty
    if (url.includes("environment.data.gov.uk")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Nearest postcodes
    if (url.includes("api.postcodes.io/postcodes") && url.includes("nearest")) {
      return new Response(JSON.stringify({ status: 200, result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Ofcom mobile / broadband — 404 (no API key in test)
    if (url.includes("ofcom") || url.includes("api-proxy.ofcom")) {
      return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
    }

    // OpenChargeMap
    if (url.includes("openchargemap")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    // Fallback: return empty OK for any other external call
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ---------------------------------------------------------------------------
// Test server + cleanup
// ---------------------------------------------------------------------------

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;
let pool: Pool;

const originalFetch = globalThis.fetch;

// Track postcodes assessed during tests so we can clean them up
const usedPostcodes: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${port}`;

  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

after(async () => {
  httpServer.close();
  globalThis.fetch = originalFetch;
  // Clean up test rows
  if (usedPostcodes.length > 0) {
    await pool.query(
      `DELETE FROM assessments WHERE postcode = ANY($1::text[])`,
      [usedPostcodes],
    );
  }
  await pool.end();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helper: delete any cached assessment so the server always runs a fresh fetch
// ---------------------------------------------------------------------------
async function clearCachedAssessment(postcode: string): Promise<void> {
  await pool.query("DELETE FROM assessments WHERE postcode = $1", [postcode]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("airQualityEstimated stored as true when DEFRA returns empty stations list", async () => {
  await clearCachedAssessment(POSTCODE);
  usedPostcodes.push(POSTCODE);

  globalThis.fetch = buildFetchMock({ defraEmpty: true, overpassEmpty: false }) as typeof fetch;

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 201, "should create and return a new assessment (201)");
  const body = await res.json();

  assert.equal(
    (body.rawMetrics as any).airQualityEstimated,
    true,
    "rawMetrics.airQualityEstimated must be true when DEFRA returns no stations",
  );
  assert.equal(
    (body.rawMetrics as any).overpassFailed,
    false,
    "rawMetrics.overpassFailed must be false when Overpass returns valid elements",
  );
});

test("overpassFailed stored as true when all Overpass mirrors return empty elements", async () => {
  await clearCachedAssessment(POSTCODE);

  globalThis.fetch = buildFetchMock({ defraEmpty: false, overpassEmpty: true }) as typeof fetch;

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 201, "should create and return a new assessment (201)");
  const body = await res.json();

  assert.equal(
    (body.rawMetrics as any).overpassFailed,
    true,
    "rawMetrics.overpassFailed must be true when all Overpass mirrors return empty elements",
  );
  assert.equal(
    (body.partialData as boolean),
    true,
    "partialData column must be true when overpassFailed is true",
  );
});

test("both flags stored as true when both DEFRA and Overpass fail simultaneously", async () => {
  await clearCachedAssessment(POSTCODE);

  globalThis.fetch = buildFetchMock({ defraEmpty: true, overpassEmpty: true }) as typeof fetch;

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 201, "should create and return a new assessment (201)");
  const body = await res.json();

  assert.equal(
    (body.rawMetrics as any).airQualityEstimated,
    true,
    "rawMetrics.airQualityEstimated must be true when DEFRA has no stations",
  );
  assert.equal(
    (body.rawMetrics as any).overpassFailed,
    true,
    "rawMetrics.overpassFailed must be true when all Overpass mirrors are empty",
  );
  assert.equal(
    (body.partialData as boolean),
    true,
    "partialData column must be true when overpassFailed is true",
  );
});
