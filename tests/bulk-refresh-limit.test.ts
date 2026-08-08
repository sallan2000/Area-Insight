/**
 * Integration tests: POST /api/admin/refresh-partial — ?limit= batching.
 *
 * Exercises the REAL Express route handler from server/routes.ts.
 * Storage methods and globalThis.fetch are stubbed so no real DB or
 * external API calls are made.
 *
 * Covered scenarios:
 *   1. No Authorization header                          → 401 (auth guard works)
 *   2. Wrong Bearer token                               → 401 (auth guard works)
 *   3. ?limit=5 with 7 partials → 5 results, remaining=2
 *   4. ?limit=5 then ?limit=5 drains all 7 (remaining drops to 0)
 *   5. No ?limit param processes every partial at once
 *   6. ?limit=0 is clamped to 1 — exactly 1 result returned
 *
 * Run with: npx tsx --test tests/bulk-refresh-limit.test.ts
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { registerRoutes } from "../server/routes.ts";
import { storage } from "../server/storage.ts";

const ADMIN_SECRET = "bulk-refresh-test-secret";
const ADMIN_HEADERS = { Authorization: `Bearer ${ADMIN_SECRET}` };

// ---------------------------------------------------------------------------
// Minimal fake data
// ---------------------------------------------------------------------------

function makeFakePartials(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    postcode: `SW${i + 1}A 1AA`,
    partialData: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSearchedAt: new Date(),
    lastRefreshedAt: null,
    shareToken: null,
    lat: "51.501",
    lng: "-0.141",
    rawMetrics: {},
    scores: {},
  }));
}

// Minimal postcodes.io response — all fields consumed by fetchAreaMetrics / processElements.
function geoResponse(postcode: string) {
  return {
    result: {
      postcode,
      latitude: 51.501,
      longitude: -0.141,
      parish: "Westminster",
      admin_ward: "St James's",
      admin_district: "Westminster",
      outcode: "SW1A",
      country: "England",
      status: "live",
      codes: {
        lsoa: "E01004720",
        lsoa21: "E01004720",
        admin_district: "E09000033",
      },
    },
  };
}

// Stub globalThis.fetch so no real network calls leave the test process.
function buildFetchStub() {
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    // Geocode (postcodes.io) — must succeed so fetchAreaMetrics can continue
    if (url.includes("api.postcodes.io/postcodes/") && !url.includes("/nearest")) {
      const pc = decodeURIComponent(url.split("/postcodes/")[1].split("?")[0]);
      return new Response(JSON.stringify(geoResponse(pc)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Nearest postcodes (postcodes.io) — return empty list; graceful fallback
    if (url.includes("api.postcodes.io/postcodes/") && url.includes("/nearest")) {
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Overpass mirrors — return 0 elements; all mirrors fail → overpassFailed=true (safe)
    if (
      url.includes("overpass-api.de") ||
      url.includes("overpass.kumi.systems") ||
      url.includes("overpass.osm.ch")
    ) {
      return new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Police crime / neighbourhood — return empty array / 404; graceful fallback
    if (url.includes("data.police.uk")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // DEFRA air quality — 404 → graceful fallback to heuristic
    if (url.includes("uk-air.defra.gov.uk")) {
      return new Response("Not Found", { status: 404 });
    }

    // Environment Agency flood monitoring — 404 → graceful fallback
    if (url.includes("environment.data.gov.uk")) {
      return new Response("Not Found", { status: 404 });
    }

    // Everything else (Ofcom, OpenChargeMap, etc.) — 404; each has a graceful catch
    return new Response("Not Found", { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const savedStorage = {
  getPartialAssessments: storage.getPartialAssessments?.bind(storage),
  createAssessment: storage.createAssessment?.bind(storage),
};

before(async () => {
  process.env.ADMIN_SECRET = ADMIN_SECRET;
  // Ensure API key env vars are absent so Ofcom/OpenChargeMap skip network calls
  delete process.env.OFCOM_API_KEY;
  delete process.env.OFCOM_BROADBAND_API_KEY;
  delete process.env.OPENCHARGEMAP_API_KEY;

  const app = express();
  app.use(express.json());
  httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  httpServer.close();
  process.env.ADMIN_SECRET = originalEnv.ADMIN_SECRET;
  if (originalEnv.OFCOM_API_KEY !== undefined) process.env.OFCOM_API_KEY = originalEnv.OFCOM_API_KEY;
  if (originalEnv.OFCOM_BROADBAND_API_KEY !== undefined) process.env.OFCOM_BROADBAND_API_KEY = originalEnv.OFCOM_BROADBAND_API_KEY;
  if (originalEnv.OPENCHARGEMAP_API_KEY !== undefined) process.env.OPENCHARGEMAP_API_KEY = originalEnv.OPENCHARGEMAP_API_KEY;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  // Restore storage stubs after every test
  storage.getPartialAssessments = savedStorage.getPartialAssessments!;
  storage.createAssessment = savedStorage.createAssessment!;
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Auth guard (belt-and-suspenders — primary coverage lives in admin-auth.test.ts)
// ---------------------------------------------------------------------------

test("POST /api/admin/refresh-partial — no Authorization header → 401", async () => {
  const res = await originalFetch(`${serverUrl}/api/admin/refresh-partial`, { method: "POST" });
  assert.equal(res.status, 401, "should reject callers with no auth header");
  const body = await res.json() as any;
  assert.ok(body.message, "should include an error message");
});

test("POST /api/admin/refresh-partial — wrong Bearer token → 401", async () => {
  const res = await originalFetch(`${serverUrl}/api/admin/refresh-partial`, {
    method: "POST",
    headers: { Authorization: "Bearer totally-wrong" },
  });
  assert.equal(res.status, 401, "should reject callers with the wrong token");
  const body = await res.json() as any;
  assert.ok(body.message, "should include an error message");
});

// ---------------------------------------------------------------------------
// Limit parameter — core logic
// ---------------------------------------------------------------------------

test("?limit=5 with 7 partials → exactly 5 results and remaining=2", async () => {
  const fakePartials = makeFakePartials(7);

  storage.getPartialAssessments = async () => fakePartials as any;
  // Prevent real DB writes; return a minimal Assessment shape
  storage.createAssessment = async (data: any, id: any) =>
    ({ id: id ?? 999, ...data } as any);
  globalThis.fetch = buildFetchStub() as any;

  const res = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial?limit=5`,
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res.status, 200, "should return 200");

  const body = await res.json() as any;

  assert.equal(
    body.results.length,
    5,
    `results array should contain exactly 5 entries, got ${body.results.length}`,
  );
  assert.equal(
    body.remaining,
    2,
    `remaining should be 2 (7 - 5), got ${body.remaining}`,
  );
  assert.equal(typeof body.refreshed, "number", "should include a refreshed count");
  assert.equal(typeof body.failed, "number", "should include a failed count");
  assert.ok(
    body.message.includes("queued") || body.message.includes("Batch"),
    `message should hint at remaining work, got: "${body.message}"`,
  );
});

test("?limit=5 first call + ?limit=5 second call drains all 7 partials", async () => {
  const allPartials = makeFakePartials(7);

  // Simulate the state: after the first call processes 5, the store holds only the last 2.
  let callCount = 0;
  storage.getPartialAssessments = async () => {
    callCount++;
    return (callCount === 1 ? allPartials : allPartials.slice(5)) as any;
  };
  storage.createAssessment = async (data: any, id: any) =>
    ({ id: id ?? 999, ...data } as any);
  globalThis.fetch = buildFetchStub() as any;

  // First call
  const res1 = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial?limit=5`,
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res1.status, 200);
  const body1 = await res1.json() as any;
  assert.equal(body1.results.length, 5, "first call: 5 processed");
  assert.equal(body1.remaining, 2, "first call: 2 remaining");

  // Second call — only 2 remain in the simulated store
  const res2 = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial?limit=5`,
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res2.status, 200);
  const body2 = await res2.json() as any;
  assert.equal(body2.results.length, 2, "second call: 2 processed");
  assert.equal(body2.remaining, 0, "second call: remaining should be 0");
  assert.ok(
    body2.message.toLowerCase().includes("complete"),
    `final message should confirm completion, got: "${body2.message}"`,
  );
});

test("no ?limit param processes all partials in one call", async () => {
  const fakePartials = makeFakePartials(4);

  storage.getPartialAssessments = async () => fakePartials as any;
  storage.createAssessment = async (data: any, id: any) =>
    ({ id: id ?? 999, ...data } as any);
  globalThis.fetch = buildFetchStub() as any;

  const res = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial`,   // no limit
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res.status, 200);

  const body = await res.json() as any;
  assert.equal(body.results.length, 4, "all 4 partials should be processed");
  assert.equal(body.remaining, 0, "remaining should be 0 when no limit is set");
});

test("?limit=0 is clamped to 1 — exactly 1 result returned", async () => {
  const fakePartials = makeFakePartials(3);

  storage.getPartialAssessments = async () => fakePartials as any;
  storage.createAssessment = async (data: any, id: any) =>
    ({ id: id ?? 999, ...data } as any);
  globalThis.fetch = buildFetchStub() as any;

  const res = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial?limit=0`,
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res.status, 200);

  const body = await res.json() as any;
  assert.equal(
    body.results.length,
    1,
    `limit=0 should be clamped to 1, got ${body.results.length} result(s)`,
  );
  assert.equal(body.remaining, 2, "remaining should reflect only 1 was processed");
});

test("empty partial list → refreshed=0, remaining=0, no error", async () => {
  storage.getPartialAssessments = async () => [];
  globalThis.fetch = buildFetchStub() as any;

  const res = await originalFetch(
    `${serverUrl}/api/admin/refresh-partial?limit=5`,
    { method: "POST", headers: ADMIN_HEADERS },
  );
  assert.equal(res.status, 200);

  const body = await res.json() as any;
  assert.equal(body.refreshed, 0, "no partials to refresh");
  assert.equal(body.remaining, 0, "remaining should be 0");
  assert.ok(body.message, "should include a message");
});
