/**
 * Integration tests: postcode-level cooldown on POST /api/assess
 *
 * These tests exercise the REAL Express route handler from server/routes.ts.
 * Storage methods are replaced on the shared ESM module instance so the route
 * handler sees the same mock the test configures. global.fetch is intercepted
 * to track whether fetchAreaMetrics tried to call any external API.
 */

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { registerRoutes } from "../server/routes.ts";
import { storage } from "../server/storage.ts";
import { REFRESH_COOLDOWN_MS } from "../server/rateLimits.ts";

const POSTCODE = "SW1A 1AA";

function makeAssessment(overrides: {
  lastSearchedAt: Date | null;
  lastRefreshedAt: Date | null;
  partialData: boolean;
}) {
  return {
    id: 1,
    shareToken: "test-token-abc",
    postcode: POSTCODE,
    lat: "51.501",
    lng: "-0.142",
    rawMetrics: {},
    scores: {},
    userId: null,
    createdAt: new Date("2025-01-01"),
    ...overrides,
  } as any;
}

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;

const originalStorage = {
  getAssessmentByPostcode: storage.getAssessmentByPostcode.bind(storage),
  createAssessment: storage.createAssessment.bind(storage),
  updateLastSearchedAt: storage.updateLastSearchedAt.bind(storage),
  recordUserSearch: storage.recordUserSearch.bind(storage),
};

const originalFetch = globalThis.fetch;

before(async () => {
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
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  storage.getAssessmentByPostcode = originalStorage.getAssessmentByPostcode;
  storage.createAssessment = originalStorage.createAssessment;
  storage.updateLastSearchedAt = originalStorage.updateLastSearchedAt;
  storage.recordUserSearch = originalStorage.recordUserSearch;
  globalThis.fetch = originalFetch;
});

test("returns cached data and skips external fetch when assessment is fresh (within cache TTL)", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("fetch must not be called"); };

  const freshAssessment = makeAssessment({
    lastSearchedAt: new Date(),
    lastRefreshedAt: null,
    partialData: false,
  });
  storage.getAssessmentByPostcode = async () => freshAssessment;
  storage.updateLastSearchedAt = async () => {};
  storage.recordUserSearch = async () => {};

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 200, "should return 200 for a fresh cached assessment");
  const body = await res.json();
  assert.equal(body.shareToken, freshAssessment.shareToken);
  assert.equal(fetchCalled, false, "should not call external APIs for a fresh assessment");
});

test("serves cached data without calling external APIs when stale but within refresh cooldown", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("external fetch must not be called"); };

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  const staleRecentlyRefreshed = makeAssessment({
    lastSearchedAt: twoDaysAgo,
    lastRefreshedAt: thirtyMinutesAgo,
    partialData: true,
  });

  storage.getAssessmentByPostcode = async () => staleRecentlyRefreshed;
  storage.updateLastSearchedAt = async () => {};
  storage.recordUserSearch = async () => {};

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 200,
    "should return 200 (cached) even though cache TTL is expired, because lastRefreshedAt is within cooldown");
  const body = await res.json();
  assert.equal(body.shareToken, staleRecentlyRefreshed.shareToken,
    "should return the same assessment record, not a re-fetched one");
  assert.equal(fetchCalled, false,
    "must not call any external APIs when the refresh cooldown is still active");
});

test("allows re-fetch when stale and refresh cooldown has expired", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  assert.equal(twoHoursAgo.getTime() < Date.now() - REFRESH_COOLDOWN_MS, true,
    "twoHoursAgo must be outside the cooldown window for this test to be valid");

  const staleExpiredCooldown = makeAssessment({
    lastSearchedAt: twoDaysAgo,
    lastRefreshedAt: twoHoursAgo,
    partialData: true,
  });

  storage.getAssessmentByPostcode = async () => staleExpiredCooldown;

  let externalFetchAttempted = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("postcodes.io") || url.includes("overpass") || url.includes("police.uk")) {
      externalFetchAttempted = true;
    }
    const errorResponse = new Response(JSON.stringify({ status: 500 }), { status: 500 });
    return errorResponse;
  };

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.notEqual(res.status, 200, "should not return the stale cached assessment without re-fetching");
  assert.equal(externalFetchAttempted, true,
    "must attempt to call external APIs when the cooldown has expired and cache is stale");
});

test("allows re-fetch when lastRefreshedAt is exactly 1 ms past the cooldown boundary", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  // 1 ms beyond the cooldown window — elapsed > REFRESH_COOLDOWN_MS so the guard must not fire
  const justExpired = new Date(Date.now() - REFRESH_COOLDOWN_MS - 1);

  const staleJustExpired = makeAssessment({
    lastSearchedAt: twoDaysAgo,
    lastRefreshedAt: justExpired,
    partialData: true,
  });

  storage.getAssessmentByPostcode = async () => staleJustExpired;

  let externalFetchAttempted = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("postcodes.io") || url.includes("overpass") || url.includes("police.uk")) {
      externalFetchAttempted = true;
    }
    return new Response(JSON.stringify({ status: 500 }), { status: 500 });
  };

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.notEqual(res.status, 200,
    "should not serve cached data when cooldown has just expired (1 ms past boundary)");
  assert.equal(externalFetchAttempted, true,
    "must attempt external API calls when lastRefreshedAt is 1 ms past the cooldown boundary");
});

test("serves cached data when lastRefreshedAt is just inside the cooldown boundary", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  // 5 seconds inside the cooldown window — elapsed is clearly < REFRESH_COOLDOWN_MS.
  // Using 5 s (not 1 ms) keeps the test deterministic: the HTTP round-trip is ~5–20 ms
  // so a 1 ms margin would flip to the expired side before the route evaluates it.
  const almostExpired = new Date(Date.now() - REFRESH_COOLDOWN_MS + 5000);

  const staleAlmostExpired = makeAssessment({
    lastSearchedAt: twoDaysAgo,
    lastRefreshedAt: almostExpired,
    partialData: true,
  });

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("external fetch must not be called when cooldown is still active");
  };

  storage.getAssessmentByPostcode = async () => staleAlmostExpired;
  storage.updateLastSearchedAt = async () => {};
  storage.recordUserSearch = async () => {};

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: POSTCODE }),
  });

  assert.equal(res.status, 200,
    "should return cached data when lastRefreshedAt is 1 ms before the cooldown boundary");
  const body = await res.json();
  assert.equal(body.shareToken, staleAlmostExpired.shareToken,
    "should return the same cached assessment, not a re-fetched one");
  assert.equal(fetchCalled, false,
    "must not call any external APIs when cooldown is still active (1 ms before boundary)");
});

test("same postcode submitted twice in quick succession — second call returns same cached record without re-fetch", async () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const staleRecentlyRefreshed = makeAssessment({
    lastSearchedAt: twoDaysAgo,
    lastRefreshedAt: fiveMinutesAgo,
    partialData: true,
  });

  let fetchCallCount = 0;
  globalThis.fetch = async () => { fetchCallCount++; throw new Error("external fetch must not be called"); };
  storage.getAssessmentByPostcode = async () => staleRecentlyRefreshed;
  storage.updateLastSearchedAt = async () => {};
  storage.recordUserSearch = async () => {};

  const [res1, res2] = await Promise.all([
    originalFetch(`${serverUrl}/api/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcode: POSTCODE }),
    }),
    originalFetch(`${serverUrl}/api/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcode: POSTCODE }),
    }),
  ]);

  assert.equal(res1.status, 200, "first quick submission should return cached data");
  assert.equal(res2.status, 200, "second quick submission should also return cached data");
  assert.equal(fetchCallCount, 0,
    "neither submission should trigger an external API call when cooldown is active");
});
