import rateLimit from "express-rate-limit";

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
