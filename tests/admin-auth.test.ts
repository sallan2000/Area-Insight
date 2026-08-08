/**
 * Integration tests: admin endpoint authentication guard (requireAdmin middleware).
 *
 * These tests exercise the REAL Express route handler from server/routes.ts.
 * Storage methods are replaced on the shared ESM module instance so no real DB
 * or external API calls are made.
 *
 * Covered scenarios for both GET /api/admin/partial-assessments
 * and POST /api/admin/refresh-partial:
 *   1. No Authorization header          → 401
 *   2. Wrong Bearer token               → 401
 *   3. Correct Bearer token             → 200
 *
 * Run with: npx tsx --test tests/admin-auth.test.ts
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { registerRoutes } from "../server/routes.ts";
import { storage } from "../server/storage.ts";

const ADMIN_SECRET = "test-admin-secret-xyz";

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;

const originalEnv = { ...process.env };

const originalStorage = {
  getPartialAssessments: storage.getPartialAssessments?.bind(storage),
};

const originalFetch = globalThis.fetch;

before(async () => {
  process.env.ADMIN_SECRET = ADMIN_SECRET;

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
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  if (originalStorage.getPartialAssessments) {
    storage.getPartialAssessments = originalStorage.getPartialAssessments;
  }
  globalThis.fetch = originalFetch;
});

function stubPartialAssessments() {
  storage.getPartialAssessments = async () => [];
}

// ---------------------------------------------------------------------------
// GET /api/admin/partial-assessments
// ---------------------------------------------------------------------------

test("GET /api/admin/partial-assessments — no Authorization header → 401", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/partial-assessments`);

  assert.equal(res.status, 401, "should return 401 when no Authorization header is sent");
  const body = await res.json();
  assert.ok(body.message, "should include an error message");
});

test("GET /api/admin/partial-assessments — wrong Bearer token → 401", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/partial-assessments`, {
    headers: { Authorization: "Bearer wrong-secret-value" },
  });

  assert.equal(res.status, 401, "should return 401 when the wrong secret is supplied");
  const body = await res.json();
  assert.ok(body.message, "should include an error message");
});

test("GET /api/admin/partial-assessments — correct Bearer token → 200", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/partial-assessments`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });

  assert.equal(res.status, 200, "should return 200 when the correct secret is supplied");
  const body = await res.json();
  assert.equal(typeof body.count, "number", "response should include a count field");
  assert.ok(Array.isArray(body.assessments), "response should include an assessments array");
});

// ---------------------------------------------------------------------------
// POST /api/admin/refresh-partial
// ---------------------------------------------------------------------------

test("POST /api/admin/refresh-partial — no Authorization header → 401", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/refresh-partial`, {
    method: "POST",
  });

  assert.equal(res.status, 401, "should return 401 when no Authorization header is sent");
  const body = await res.json();
  assert.ok(body.message, "should include an error message");
});

test("POST /api/admin/refresh-partial — wrong Bearer token → 401", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/refresh-partial`, {
    method: "POST",
    headers: { Authorization: "Bearer totally-wrong-secret" },
  });

  assert.equal(res.status, 401, "should return 401 when the wrong secret is supplied");
  const body = await res.json();
  assert.ok(body.message, "should include an error message");
});

test("POST /api/admin/refresh-partial — correct Bearer token → 200 (empty batch)", async () => {
  stubPartialAssessments();

  const res = await originalFetch(`${serverUrl}/api/admin/refresh-partial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });

  assert.equal(res.status, 200, "should return 200 when the correct secret is supplied");
  const body = await res.json();
  assert.equal(typeof body.refreshed, "number", "response should include a refreshed count");
});
