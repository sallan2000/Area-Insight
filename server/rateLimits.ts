import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from "express-rate-limit";

export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * A memory store for express-rate-limit that is bounded in both time and
 * capacity.
 *
 * Unlike the built-in MemoryStore, which grows to accommodate every unique IP
 * seen within the current window, BoundedMemoryStore:
 *
 *   1. Enforces a hard ceiling on the number of tracked keys (default 10,000).
 *      When the store is full, the least-recently-used entry is evicted before
 *      a new key is inserted, so memory is O(maxKeys) regardless of traffic
 *      volume or the cardinality of source IPs.
 *
 *   2. Runs a periodic background cleanup (every windowMs / 2) that deletes
 *      expired entries. This guarantees the store shrinks even when traffic
 *      stops after a high-cardinality burst — the built-in MemoryStore and
 *      most PostgreSQL adapters only prune on the next incoming request.
 *
 * The store is intentionally in-process. A persistent external store (Redis,
 * PostgreSQL) is only necessary once the application runs across multiple
 * server processes that need to share a counter. At that point, wire in a
 * Redis adapter with a configured maxmemory-policy and TTL.
 */
class BoundedMemoryStore implements Store {
  private readonly maxKeys: number;
  private windowMs!: number;
  private readonly hits: Map<string, { totalHits: number; resetTime: Date }> =
    new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    // Prune expired entries at half-window intervals so the store drains
    // promptly even when traffic has stopped.
    const intervalMs = Math.max(this.windowMs / 2, 60_000);
    this.cleanupTimer = setInterval(() => this.pruneExpired(), intervalMs);
    // Allow the Node.js process to exit even if this timer is still running.
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  increment(key: string): ClientRateLimitInfo {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (existing && existing.resetTime.getTime() > now) {
      // Active entry — bump its counter.  Re-insert to move it to the "most
      // recently used" end of the Map so LRU eviction targets idle keys first.
      this.hits.delete(key);
      existing.totalHits += 1;
      this.hits.set(key, existing);
      return { totalHits: existing.totalHits, resetTime: existing.resetTime };
    }

    // New key or expired window — open a fresh window.
    if (this.hits.size >= this.maxKeys) {
      // Evict the least-recently-used entry (first key in insertion order).
      const lruKey = this.hits.keys().next().value;
      if (lruKey !== undefined) this.hits.delete(lruKey);
    }

    const resetTime = new Date(now + this.windowMs);
    this.hits.set(key, { totalHits: 1, resetTime });
    return { totalHits: 1, resetTime };
  }

  decrement(key: string): void {
    const entry = this.hits.get(key);
    if (entry && entry.totalHits > 0) {
      entry.totalHits -= 1;
    }
  }

  resetKey(key: string): void {
    this.hits.delete(key);
  }

  resetAll(): void {
    this.hits.clear();
  }

  /** Remove all entries whose window has expired. */
  private pruneExpired(): void {
    const now = Date.now();
    this.hits.forEach((entry, key) => {
      if (entry.resetTime.getTime() <= now) {
        this.hits.delete(key);
      }
    });
  }
}

export const assessRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => ((req as any).user ? 30 : 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new BoundedMemoryStore(),
  message: { message: "Too many assessment requests, please try again later." },
});

export const shareRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new BoundedMemoryStore(),
  message: { message: "Too many share requests, please try again later." },
});
