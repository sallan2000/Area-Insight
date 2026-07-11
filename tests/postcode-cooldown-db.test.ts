/**
 * DB-backed integration tests: stale-cache cooldown guard on POST /api/assess
 *
 * Unlike tests/postcode-cooldown.test.ts (which mocks storage), these tests
 * run the REAL Express server with the REAL DatabaseStorage against the live
 * PostgreSQL database. Only globalThis.fetch is intercepted so that external
 * API calls are tracked without actually hitting the internet.
 *
 * This validates that the cooldown guard works correctly when:
 *   - The in-memory state is empty (simulating a server restart)
 *   - Cooldown status comes entirely from the DB `lastRefreshedAt` column
 *
 * Run with: npx tsx --test tests/postcode-cooldown-db.test.ts
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { registerRoutes } from "../server/routes.ts";
import { db } from "../server/db.ts";
import { assessments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { REFRESH_COOLDOWN_MS } from "../server/rateLimits.ts";

const TEST_POSTCODE = "ZZ1 9ZZ";

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;
let insertedId: number | undefined;
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

after(async () => {
  httpServer.close();
  globalThis.fetch = originalFetch;
  if (insertedId !== undefined) {
    await db.delete(assessments).where(eq(assessments.id, insertedId));
  }
});

test("POST /api/assess returns cached record (no external fetch) when stale but lastRefreshedAt is within cooldown — real DB", async () => {
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  const [row] = await db.insert(assessments).values({
    shareToken: randomUUID(),
    postcode: TEST_POSTCODE,
    lat: "51.500",
    lng: "-0.124",
    rawMetrics: { test: true } as any,
    scores: { overall: 50 } as any,
    partialData: false,
    lastSearchedAt: thirtyOneDaysAgo,
    lastRefreshedAt: thirtyMinutesAgo,
  }).returning();

  insertedId = row.id;

  let externalFetchCalled = false;
  globalThis.fetch = async () => {
    externalFetchCalled = true;
    throw new Error("external fetch must not be called while cooldown is active");
  };

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: TEST_POSTCODE }),
  });

  assert.equal(
    res.status,
    200,
    "should return 200 (cached) when stale but lastRefreshedAt is within the 1-hour cooldown",
  );

  const body = await res.json();
  assert.equal(
    body.shareToken,
    row.shareToken,
    "should return the exact same assessment record from the DB",
  );
  assert.equal(
    externalFetchCalled,
    false,
    "must not call any external APIs while the DB-backed cooldown is active",
  );
});

test("POST /api/assess triggers external re-fetch when stale and lastRefreshedAt is past the cooldown window — real DB", async () => {
  assert.ok(
    insertedId !== undefined,
    "the DB row from the previous test must exist",
  );

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  assert.ok(
    twoHoursAgo.getTime() < Date.now() - REFRESH_COOLDOWN_MS,
    "twoHoursAgo must be outside the cooldown window for this test to be valid",
  );

  await db.update(assessments)
    .set({
      lastRefreshedAt: twoHoursAgo,
      lastSearchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })
    .where(eq(assessments.id, insertedId!));

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

  const res = await originalFetch(`${serverUrl}/api/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postcode: TEST_POSTCODE }),
  });

  assert.notEqual(
    res.status,
    200,
    "should not return a 200 cache-hit when the cooldown has expired — must try to re-fetch",
  );
  assert.equal(
    externalFetchAttempted,
    true,
    "must attempt to call external APIs (postcodes.io / overpass / police) once the cooldown expires",
  );
});
