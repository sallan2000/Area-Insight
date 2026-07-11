import rateLimit from "express-rate-limit";

export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
const refreshCooldownStore = new Map<string, number>();

export function checkRefreshCooldown(token: string): { allowed: boolean; retryAfterMs: number } {
  const lastRefresh = refreshCooldownStore.get(token);
  const now = Date.now();
  if (lastRefresh !== undefined) {
    const elapsed = now - lastRefresh;
    if (elapsed < REFRESH_COOLDOWN_MS) {
      return { allowed: false, retryAfterMs: REFRESH_COOLDOWN_MS - elapsed };
    }
  }
  refreshCooldownStore.set(token, now);
  return { allowed: true, retryAfterMs: 0 };
}

export const assessRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => ((req as any).user ? 30 : 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many assessment requests, please try again later." },
});

export const shareRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many share requests, please try again later." },
});
