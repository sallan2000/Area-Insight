# Threat Model

## Project Overview

ScoreMyStreet is a public web application that generates UK postcode reports using a React frontend, an Express/Node.js backend, PostgreSQL storage, and several third-party data providers. Users can create reports without logging in, while logged-in users can also keep a private search history through Replit Auth and server-side sessions.

Production scope for security review is the Express server in `server/`, the shared schemas in `shared/`, and the browser code in `client/src/` that consumes production APIs. Development-only Vite middleware is out of scope unless separately exposed in production.

## Assets

- **User sessions and account records** — Replit Auth session cookies, refresh tokens stored in the server session, and user profile records in PostgreSQL. Compromise would allow account takeover or unauthorized access to private history.
- **User search history** — the list of postcode reports a signed-in user has viewed or created. This is private behavioral data even though some individual reports are intentionally shareable.
- **Stored assessment reports** — postcode, latitude/longitude, raw external-data metrics, and calculated scores. These reports are core application data and must not be exposed beyond the intended sharing model.
- **Application secrets** — database connection string, session secret, Replit OIDC identifiers, and third-party API keys. Exposure would allow infrastructure or quota abuse.
- **Third-party API quota and availability** — postcodes.io, Police API, Overpass, Ofcom, DEFRA, EA, and OpenChargeMap requests are expensive dependencies that can be abused through public endpoints.

## Trust Boundaries

- **Browser to API** — all client input, route parameters, and fetch calls are untrusted until validated by the Express server.
- **API to PostgreSQL** — the server has direct read/write access to stored reports, user history, sessions, and share request records.
- **API to external data providers** — the backend imports location and neighbourhood data from third parties and then stores and renders parts of that data to users.
- **Public to authenticated user boundary** — report creation and viewing are public-facing, while `/api/auth/user` and `/api/my-assessments` are authenticated surfaces.
- **Development to production boundary** — `server/vite.ts` and other development helpers should be ignored unless production routing reaches them.

## Scan Anchors

- **Production entry points** — `server/index.ts`, `server/routes.ts`, `server/replit_integrations/auth/`
- **Highest-risk areas** — public assessment routes, authenticated history route, Replit Auth session handling, and any client HTML rendering sinks
- **Public surfaces** — `/api/assess`, `/api/assess/:id`, `/api/assess/:id/refresh`, `/api/share`, `/report/:id`, `/compare`
- **Authenticated surfaces** — `/api/auth/user`, `/api/my-assessments`, `/history`
- **Usually dev-only** — `server/vite.ts` and Vite middleware paths

## Threat Categories

### Spoofing

Users authenticate through Replit Auth and a PostgreSQL-backed session store. The application must only treat a request as authenticated when the server-side session is valid, refreshed if expired, and bound to a trustworthy proxy-derived host and client IP context. Protected endpoints must use the same server-side auth checks consistently rather than relying on frontend state.

### Tampering

Public users can trigger report creation and refresh flows that write to the database. The server must ensure that public callers cannot modify stored data outside the intended anonymous-report model, and that any state-changing endpoint validates both input and authorization before updating existing records.

### Information Disclosure

This app intentionally exposes some reports publicly, but it also promises private logged-in search history. The system must prevent attackers from bulk-harvesting stored reports or inferring private user activity through predictable identifiers, overly broad API responses, logs, or third-party content rendered back into report pages.

### Denial of Service

Report generation fans out to multiple external APIs and can consume quota or tie up server resources. Public endpoints must be rate-limited tightly enough to prevent automated abuse, scraping, or forced refresh loops from degrading service or exhausting third-party allowances.

### Elevation of Privilege

The main privilege boundary is between anonymous users, authenticated users, and the private history surface. The application must prevent direct object reference issues, missing ownership checks, and any injection path that would let untrusted input or external HTML execute in the browser or alter server-side behavior beyond intended permissions.
