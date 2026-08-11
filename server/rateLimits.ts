import crypto from "crypto";
import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from "express-rate-limit";

export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Anonymous-session rate-limit keying.
 *
 * The default express-rate-limit key is the client IP derived from
 * X-Forwarded-For. With `app.set("trust proxy", 1)` Replit's proxy is trusted,
 * but any caller that can set XFF (or a shared NAT/office egress) can rotate the
 * apparent IP and evade the anonymous quota — the #1 abuse vector in the threat
 * model (third-party quota exhaustion: postcodes.io, police.uk, Overpass, Ofcom).
 *
 * To stop IP-spoof evasion we key anonymous traffic by a first-party HttpOnly
 * cookie set by this server, not by IP. Authenticated traffic keeps the stable
 * per-user key. The IP is still used (via the proxy) only as a fallback.
 */
const ANON_COOKIE = "sms_anon";
const ANON_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readAnonCookie(req: any): string | null {
  const header = req.headers?.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === ANON_COOKIE) {
      const val = part.slice(idx + 1).trim();
      return val || null;
    }
  }
  return null;
}

/**
 * Returns the anonymous ID, issuing and setting the cookie if absent.
 * Modifies `res` only when a new cookie is needed, so repeated requests are
 * stable. Falls back to the request IP if the cookie cannot be written.
 */
function ensureAnonId(req: any, res: any): string {
  const existing = readAnonCookie(req);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const secure = process.env.NODE_ENV === "production";
  try {
    res.cookie(ANON_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: ANON_COOKIE_MAX_AGE_MS,
      path: "/",
    });
  } catch {
    // res.cookie unavailable (e.g. already-sent headers) — fall back to IP.
    return clientIp(req);
  }
  return id;
}

function clientIp(req: any): string {
  const ip =
    req.ip ||
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  return String(ip);
}

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
  // Anonymous users keyed by first-party cookie (spoof-proof); signed-in users
  // keyed by stable user id; falls back to IP if the cookie can't be set.
  keyGenerator: (req, res) => {
    const userId = (req as any).user?.claims?.sub;
    if (userId) return `u:${userId}`;
    return `a:${ensureAnonId(req, res)}`;
  },
  message: { message: "Too many assessment requests, please try again later." },
});

export const shareRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new BoundedMemoryStore(),
  keyGenerator: (req, res) => {
    const userId = (req as any).user?.claims?.sub;
    if (userId) return `u:${userId}`;
    return `a:${ensureAnonId(req, res)}`;
  },
  message: { message: "Too many share requests, please try again later." },
});
