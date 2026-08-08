/**
 * Integration tests: DB-backed refresh cooldown on POST /api/assess/token/:token/refresh
 *
 * These tests exercise the REAL Express route handler from server/routes.ts.
 * Storage methods are replaced on the shared ESM module instance so no real DB
 * or external API calls are made. globalThis.fetch is intercepted to verify
 * whether fetchAreaMetrics tried to call any external API.
 *
 * Key guarantee under test
 * ─────────────────────────
 * The 1-hour cooldown is enforced via `lastRefreshedAt` in PostgreSQL, NOT an
 * in-memory Map. After a server restart the in-memory Map is empty, so
 * correctness depends entirely on the DB value. The tests below replicate that
 * scenario: the Express app is freshly initialised (no prior in-memory state)
 * yet the cooldown is still enforced when `lastRefreshedAt` is recent.
 *
 * Run with: npx tsx --test tests/refresh-cooldown-db.test.ts
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { registerRoutes } from "../server/routes.ts";
import { storage } from "../server/storage.ts";
import { REFRESH_COOLDOWN_MS } from "../server/rateLimits.ts";

const TOKEN = "test-share-token-refresh-cooldown";
const POSTCODE = "SW1A 2AA";

function makeAssessment(lastRefreshedAt: Date | null) {
  return {
    id: 42,
    shareToken: TOKEN,
    postcode: POSTCODE,
    lat: "51.500",
    lng: "-0.124",
    rawMetrics: {},
    scores: {},
    userId: null,
    partialData: false,
    createdAt: new Date("2025-01-01"),
    lastSearchedAt: new Date(),
    lastRefreshedAt,
  } as any;
}

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;

const originalStorage = {
  getAssessmentByToken: storage.getAssessmentByToken.bind(storage),
  createAssessment: storage.createAssessment.bind(storage),
  recordUserSearch: storage.recordUserSearch.bind(storage),
  updateLastSearchedAt: storage.updateLastSearchedAt.bind(storage),
};

const originalFetch = globalThis.fetch;

before(async () => {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    (req as any).user = { claims: { sub: "test-user-id" } };
    next();
  });

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
  storage.getAssessmentByToken = originalStorage.getAssessmentByToken;
  storage.createAssessment = originalStorage.createAssessment;
  storage.recordUserSearch = originalStorage.recordUserSearch;
  storage.updateLastSearchedAt = originalStorage.updateLastSearchedAt;
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Scenario 1 — cooldown still active (simulates a server restart)
//
// The in-memory Map in rateLimits.ts is empty (fresh process), but
// lastRefreshedAt is recent in the DB. The route must still return 429.
// ---------------------------------------------------------------------------

test("returns 429 when lastRefreshedAt is within the 1-hour window (DB-backed, survives server restart)", async () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  storage.getAssessmentByToken = async () => makeAssessment(thirtyMinutesAgo);

  let externalFetchCalled = false;
  globalThis.fetch = async () => {
    externalFetchCalled = true;
    throw new Error("external fetch must not be called during cooldown");
  };

  const res = await originalFetch(
    `${serverUrl}/api/assess/token/${TOKEN}/refresh`,
    { method: "POST" },
  );

  assert.equal(
    res.status,
    429,
    "should return 429 when the DB shows a recent lastRefreshedAt — even with no in-memory state",
  );

  const body = await res.json();
  assert.ok(
    typeof body.retryAfterMs === "number" && body.retryAfterMs > 0,
    "response body should include retryAfterMs > 0",
  );
  assert.ok(
    body.message && body.message.includes("minute"),
    "response body should include a human-readable wait message",
  );
  assert.equal(
    externalFetchCalled,
    false,
    "must not call any external APIs while the cooldown is active",
  );
});

// ---------------------------------------------------------------------------
// Scenario 2 — cooldown elapsed; refresh is allowed
// ---------------------------------------------------------------------------

test("allows refresh and calls external APIs when lastRefreshedAt is outside the cooldown window", async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  assert.ok(
    twoHoursAgo.getTime() < Date.now() - REFRESH_COOLDOWN_MS,
    "twoHoursAgo must be outside the cooldown window for this test to be valid",
  );

  storage.getAssessmentByToken = async () => makeAssessment(twoHoursAgo);

  let externalFetchAttempted = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (
      url.includes("postcodes.io") ||
      url.includes("overpass") ||
      url.includes("police.uk")
    ) {
      externalFetchAttempted = true;
    }
    return new Response(JSON.stringify({ status: 500 }), { status: 500 });
  };

  const res = await originalFetch(
    `${serverUrl}/api/assess/token/${TOKEN}/refresh`,
    { method: "POST" },
  );

  assert.notEqual(
    res.status,
    429,
    "should not return 429 when the cooldown window has expired",
  );
  assert.equal(
    externalFetchAttempted,
    true,
    "must attempt to call external APIs when the cooldown has elapsed",
  );
});

// ---------------------------------------------------------------------------
// Scenario 3 — no prior refresh (lastRefreshedAt is null); first refresh allowed
// ---------------------------------------------------------------------------

test("allows the first refresh when lastRefreshedAt is null (report has never been refreshed)", async () => {
  storage.getAssessmentByToken = async () => makeAssessment(null);

  let externalFetchAttempted = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (
      url.includes("postcodes.io") ||
      url.includes("overpass") ||
      url.includes("police.uk")
    ) {
      externalFetchAttempted = true;
    }
    return new Response(JSON.stringify({ status: 500 }), { status: 500 });
  };

  const res = await originalFetch(
    `${serverUrl}/api/assess/token/${TOKEN}/refresh`,
    { method: "POST" },
  );

  assert.notEqual(
    res.status,
    429,
    "should not return 429 when the report has never been refreshed",
  );
  assert.equal(
    externalFetchAttempted,
    true,
    "must attempt to call external APIs for the first refresh",
  );
});

// ---------------------------------------------------------------------------
// Scenario 4 — boundary: refresh at exactly the cooldown boundary is allowed
//
// lastRefreshedAt = now - REFRESH_COOLDOWN_MS  →  elapsed === REFRESH_COOLDOWN_MS
// The comparison is `elapsed < REFRESH_COOLDOWN_MS`, so this should NOT be
// blocked (the window has fully elapsed).
// ---------------------------------------------------------------------------

test("allows refresh when lastRefreshedAt is exactly REFRESH_COOLDOWN_MS ago (boundary — elapsed === cooldown)", async () => {
  // Subtract an extra millisecond to guarantee we are at or past the boundary
  // even if a few µs elapse between constructing the date and the route reading
  // Date.now() during the request.
  const atBoundary = new Date(Date.now() - REFRESH_COOLDOWN_MS - 1);

  storage.getAssessmentByToken = async () => makeAssessment(atBoundary);

  let externalFetchAttempted = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (
      url.includes("postcodes.io") ||
      url.includes("overpass") ||
      url.includes("police.uk")
    ) {
      externalFetchAttempted = true;
    }
    return new Response(JSON.stringify({ status: 500 }), { status: 500 });
  };

  const res = await originalFetch(
    `${serverUrl}/api/assess/token/${TOKEN}/refresh`,
    { method: "POST" },
  );

  assert.notEqual(
    res.status,
    429,
    "should not return 429 when elapsed time equals or exceeds REFRESH_COOLDOWN_MS",
  );
  assert.equal(
    externalFetchAttempted,
    true,
    "must attempt external API calls when the cooldown window has fully elapsed",
  );
});

// ---------------------------------------------------------------------------
// Scenario 5 — boundary: refresh just before cooldown expires is still blocked
//
// lastRefreshedAt = now - REFRESH_COOLDOWN_MS + 30_000  →  30 s still remain.
// The comparison is `elapsed < REFRESH_COOLDOWN_MS`, so this SHOULD be blocked.
// (A 1 ms margin is theoretically correct but unreliable: JS/HTTP overhead means
// the route's own Date.now() call can push elapsed past the boundary before the
// assertion runs.  A 30-second margin is unambiguously inside the window while
// still testing the near-boundary branch.)
// ---------------------------------------------------------------------------

test("returns 429 when lastRefreshedAt is 30 s inside the cooldown window (near-boundary — still blocked)", async () => {
  // 30 seconds before the window fully elapses → still within the cooldown
  const thirtySecondsBeforeBoundary = new Date(Date.now() - REFRESH_COOLDOWN_MS + 30_000);

  storage.getAssessmentByToken = async () => makeAssessment(thirtySecondsBeforeBoundary);

  let externalFetchCalled = false;
  globalThis.fetch = async () => {
    externalFetchCalled = true;
    throw new Error("external fetch must not be called during cooldown");
  };

  const res = await originalFetch(
    `${serverUrl}/api/assess/token/${TOKEN}/refresh`,
    { method: "POST" },
  );

  assert.equal(
    res.status,
    429,
    "should return 429 when 30 s still remain in the cooldown window",
  );
  assert.equal(
    externalFetchCalled,
    false,
    "must not call external APIs while the cooldown window has not fully elapsed",
  );
});

// ---------------------------------------------------------------------------
// Scenario 6 — unauthenticated request is blocked before cooldown check
// ---------------------------------------------------------------------------

test("returns 401 for unauthenticated refresh attempt regardless of cooldown state", async () => {
  const app2 = express();
  app2.use(express.json());

  const httpServer2 = createServer(app2);
  await registerRoutes(httpServer2, app2);
  await new Promise<void>((resolve) => httpServer2.listen(0, "127.0.0.1", resolve));
  const { port: port2 } = httpServer2.address() as AddressInfo;
  const serverUrl2 = `http://127.0.0.1:${port2}`;

  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    storage.getAssessmentByToken = async () => makeAssessment(thirtyMinutesAgo);

    const res = await originalFetch(
      `${serverUrl2}/api/assess/token/${TOKEN}/refresh`,
      { method: "POST" },
    );

    assert.equal(
      res.status,
      401,
      "unauthenticated request should return 401 before reaching the cooldown check",
    );
  } finally {
    httpServer2.close();
  }
});
