import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Security headers — apply to all routes in production, only /api in dev
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
      ],
      styleSrc: [
        "'self'",
        "https://fonts.googleapis.com",
      ],
      styleSrcElem: [
        "'self'",
        "https://fonts.googleapis.com",
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://*.tile.openstreetmap.org",
      ],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
});

if (process.env.NODE_ENV === "production") {
  app.use(helmetMiddleware);
} else {
  app.use("/api", helmetMiddleware);
}

// Request/response logger — sanitises auth endpoints and truncates long bodies
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !path.startsWith("/api/auth")) {
        const bodyStr = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${bodyStr.length > 200 ? bodyStr.slice(0, 200) + "…" : bodyStr}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await setupAuth(app);
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);

  // On production boot (i.e. every Replit deploy/restart), wipe the cached
  // assessments once so stale/partial rows from a previous code version can never
  // persist and be served back. This is the automatic equivalent of
  // POST /api/admin/clear-cache. Fire-and-forget: a failure must never block boot.
  if (process.env.NODE_ENV === "production") {
    import("./storage").then(({ storage }) =>
      storage.clearAllAssessments()
        .then((r) => console.log(`[boot] cleared assessment cache: ${r.deletedAssessments} rows (${r.deletedUserSearches} user-search links)`))
        .catch((e) => console.warn("[boot] cache clear skipped:", e instanceof Error ? e.message : e))
    );
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
