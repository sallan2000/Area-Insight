# ScoreMyStreet

> UK postcode liveability scoring service. Enter a UK postcode, get a 0–100
> liveability score across Transport, Safety, Schools, and Amenities, derived
> from live UK open data.

*Repo directory name: `Area-Insight` (an earlier name). Product/brand name used
throughout the app and emails: **ScoreMyStreet**.*

---

# Part 1 — For Users

## What it does

ScoreMyStreet turns any UK postcode into an area "liveability" report. Type a
postcode, and the service pulls live UK open data and scores the area on four
things that matter when you're deciding where to live:

- **Transport** — how close the nearest train stations are (and whether any is a
  major hub), bus-stop density, and rough commute estimates.
- **Safety** — 12 months of street-crime counts near the postcode, weighted by
  crime type, with an up/down trend.
- **Schools** — the nearest primary and secondary schools.
- **Amenities** — shops, pharmacies, post offices and similar within walking
  distance, and how close the nearest supermarket is.

It also shows **environment** factors (air quality, noise, flood risk),
**connectivity** (mobile coverage, broadband speeds, EV chargers), and an
estimated **council tax band**.

All four scored categories combine into a single **Overall Liveability Score**
(0–100), graded:

| Score | Grade |
|-------|-------|
| 80–100 | Outstanding |
| 60–79 | Good |
| 40–59 | Average |
| 0–39 | Poor |

## How to use it

| Page | What you do there |
|------|-------------------|
| **Home (`/`)** | Type a UK postcode (e.g. `SW1A 1AA`) and hit **Analyse**. A loading
animation plays while the report is built. |
| **Report (`/report/:id`)** | The full breakdown: category scores, charts, a locked map, and buttons to
**export** (image/PDF) or **share** (public link or email). |
| **Compare (`/compare`)** | Put in two postcodes to see them side by side. |
| **How it works (`/how-it-works`)** | Plain-language explanation of the scoring. |
| **History (`/history`)** | Your past searches — **only if you're signed in.** |

You can use the core service **without signing in**. Signing in (via Replit)
lets you save a search history and *refresh* a report to pull fresh data.

## Sharing & exporting

- **Public link:** every report has a share token — `/api/assess/token/:token`
  resolves to the report.
- **Email:** enter an address and a styled HTML summary is sent via Resend
  (this feature requires it to be configured on the server).
- **Export:** the report can be saved as an image or PDF from the Report page.

## Things worth knowing

- **School scores are placeholders.** The list of nearest schools is real, but
  the score itself does not yet reflect real Ofsted/quality ratings.
- **Scottish safety is not scored.** Police Scotland doesn't publish via the
  police.uk API, so for Scottish postcodes the Safety score is omitted (a note is
  shown instead).
- **Crime is street-level**, within about 1.5 km of the postcode.
- **Air quality** uses real DEFRA stations when available, otherwise a location
  estimate.
- **EV-charger info is shown but does not affect the score.**
- Occasional third-party outages mean a section can come back empty; the report
  still completes and is flagged if the map/amenity layer failed.

---

# Part 2 — For Developers & Installers

## Architecture overview

```
                 ┌─────────────────────────────────────────────┐
  Browser (React)│  Home → POST /api/assess → Report            │
                 │  Report / Compare / History / HowItWorks     │
                 └───────────────┬─────────────────────────────┘
                                 │  (TanStack Query)
                                 ▼
                 ┌─────────────────────────────────────────────┐
  Express server │  server/index.ts  (helmet, logging)         │
                 │  server/routes.ts (assess/refresh/share/…)  │
                 │  server/rateLimits.ts (bounded limiter)     │
                 │  server/storage.ts  (Drizzle ORM)           │
                 └───┬───────────────────────┬─────────────────┘
                     │                        │
            ┌────────▼─────────┐      ┌───────▼──────────────┐
            │ PostgreSQL       │      │ External data APIs    │
            │ (Drizzle ORM)    │      │ postcodes.io (OSS)    │
            └──────────────────┘      │ UK Police API         │
                                      │ OSM Overpass (x3)     │
                                      │ DEFRA UK-AIR          │
                                      │ Environment Agency     │
                                      │ Ofcom Mobile/Broadband│
                                      │ OpenChargeMap         │
                                      │ Resend (email)        │
                                      └───────────────────────┘
```

- **Monorepo:** `client/` (React/Vite) + `server/` (Express/tsx) + `shared/`
  (Zod schemas and Drizzle models shared by both sides).
- **Build:** `npm run build` runs `script/build.ts` — esbuild bundles the server
  to `dist/index.cjs`, Vite bundles the client to `dist/public`. In dev, Vite
  serves the client with HMR and proxies API calls; in production the server
  serves the built assets (`server/static.ts`).
- **Port:** always binds `PORT` (default `5000`), host `0.0.0.0`.

## Data sources

| Source | Used for |
|--------|----------|
| **postcodes.io** | Geocoding (lat/lng, outcode, LSOA codes) |
| **UK Police API** | 12 months street-crime counts + neighbourhood info |
| **OpenStreetMap Overpass** (3 mirrors, raced) | Amenities, shops, schools, bus/train, roads/rail/airports (noise) |
| **DEFRA UK-AIR** | Air quality (DAQI) — nearest station, heuristic fallback |
| **Environment Agency** | Flood alerts + nearest gauge/water level |
| **Ofcom Mobile API** | 4G outdoor/indoor coverage per operator (EE/Vodafone/O2/Three) |
| **Ofcom Broadband API** | Predicted download/upload speeds (Standard/Superfast/Ultrafast) |
| **OpenChargeMap** | Nearest EV chargers (informational only — not scored) |
| **Resend** | Email share |
| **Static JSON** (`server/data/`) | Council-tax bands (England/Wales LSOA, Scotland council areas) + Scottish crime rates |

## Scoring model (technical)

`calculateScores()` in `server/routes.ts` normalises each raw metric to 0–100
and combines them:

```
total = transport * 0.25
      + sqrt(safety) * 10 * 0.35
      + amenities * 0.20
      + schools   * 0.20
```

- **Transport** blends station distance, bus density, and commute estimates; a
  nearby major hub multiplies the score by 1.2.
- **Safety** starts at 100 and subtracts weighted crime-density and a severity
  component (violent×5, burglary×3, vehicle×2, drugs×2, ASB×1), with a trend
  multiplier (down→×1.1, up→×0.8). Scotland uses a higher severity ceiling and a
  1.3 regional multiplier (Police Scotland data is unavailable via police.uk, so
  safety is excluded from the score and from emailed reports for Scottish
  postcodes).
- **Amenities** blends count, category diversity, top-rated count, and supermarket
  proximity.
- **Schools** is currently a fixed `primaryRating = secondaryRating = 80` — it
  does **not** yet reflect real Ofsted data.

Raw metrics are stored as JSON (`rawMetrics`) so the scoring function can be
re-run or tweaked without re-fetching external data.

## Data freshness & caching

- Results cached in PostgreSQL keyed by postcode.
- A cached result is served without re-fetching if **fresh**:
  - normal assessment: created within the last **90 days**
  - partial assessment (Overpass failed): searched within the last **1 day**
- Otherwise the service re-fetches everything and overwrites the row.
- Signed-in users can **refresh** (`POST /api/assess/token/:token/refresh`),
  subject to a **1-hour cooldown** (`REFRESH_COOLDOWN_MS`), and only when signed in.

## API reference

All JSON. Validation via Zod (`shared/routes.ts`).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/postcodes/:postcode/validate` | — | 422/404/502/200 `{valid}` |
| POST | `/api/assess` | rate-limited | Create/return assessment for a postcode |
| GET | `/api/assess/token/:token` | — | Fetch a shared assessment by token |
| POST | `/api/assess/token/:token/refresh` | signed-in + 1h cooldown | Re-fetch fresh data |
| GET | `/api/my-assessments` | signed-in | User's search history |
| POST | `/api/share` | rate-limited | Email the report (Resend) |
| GET | `/api/admin/partial-assessments` | `ADMIN_SECRET` | List partial assessments |
| POST | `/api/admin/refresh-partial` | `ADMIN_SECRET` | Bulk-refresh partials |

`POST /api/assess` body: `{ "postcode": "SW1A 1AA" }`. Returns the stored
`assessment` row (id, postcode, lat/lng, `rawMetrics` JSON, `scores` JSON,
`shareToken`, timestamps). `partialData: true` means the Overpass/OSM fetch
failed and transport/schools/amenities are degraded.

## Prerequisites & environment

### Required to boot

| Variable | Used by | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `server/db.ts`, sessions | PostgreSQL connection string. **Required** — throws on boot without it. |
| `SESSION_SECRET` | `replitAuth.ts` | **Required.** Fail-closed: missing secret aborts startup. |
| `REPL_ID` | Replit Auth | Required for Replit Auth OIDC discovery. |
| `ISSUER_URL` | Replit Auth | Defaults to `https://replit.com/oidc` if unset. |

### Optional (feature degrades gracefully if absent)

| Variable | Feature | Behaviour if missing |
|----------|---------|----------------------|
| `OFCOM_API_KEY` | Mobile coverage | Mobile section empty; logged warning. |
| `OFCOM_BROADBAND_API_KEY` | Broadband speeds | Broadband section empty. |
| `OPENCHARGEMAP_API_KEY` | EV chargers | EV section empty (not scored anyway). |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email share | `/api/share` returns 503. |
| `ADMIN_SECRET` | Admin endpoints | Admin routes return 403. |
| `PORT` | Listen port | Defaults to `5000`. |

Seeded reference data (council-tax bands, Scottish crime) ships in
`server/data/*.json` and loads at startup — no env var needed.

## Running locally

**On Replit (intended host):** `.replit` and `replit.nix` already configure
Node 20, PostgreSQL 16, the dev workflow, and the autoscale deploy target.
Click **Run**, or:

```bash
npm install
npm run dev          # tsx server + Vite HMR on PORT (default 5000)
```

**Self-hosting (any Node 20+ / Postgres 16+ host):**

```bash
npm install
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export SESSION_SECRET="$(openssl rand -hex 32)"
export REPL_ID="your-oidc-client-id"   # any OIDC client; Replit Auth by default
# optional feature keys (see table above)

npm run db:push      # sync Drizzle schema to Postgres (creates tables)
npm run dev          # development
# production:
npm run build && npm start
```

- `npm run db:push` uses Drizzle Kit to sync `shared/schema.ts` to the database.
  The initial schema (and `sessions` table) is also in `migrations/`.
- `npm run check` runs `tsc` for type-checking.
- A detailed Replit→self-host migration plan lives in **`RESUME.md`** (intentionally
  not committed to GitHub).

## Authentication

**Replit Auth** (OpenID Connect) via `openid-client` + `passport`, with
PostgreSQL-backed sessions (`connect-pg-simple`). Signed-in users get a `userId`
linked to their searches, a `/history` page, and the ability to refresh reports.
Authentication is **optional for the core flow** — anonymous visitors can still
assess any postcode; they just can't refresh, save history, or use admin.

## Admin endpoints

Protected by `ADMIN_SECRET` (Bearer token), not Replit Auth:

- `GET  /api/admin/partial-assessments` — list assessments flagged `partialData`.
- `POST /api/admin/refresh-partial?limit=N` — re-run data collection for partial
  assessments in batches (500 ms gap between each).

## Rate limiting

Custom `BoundedMemoryStore` (`server/rateLimits.ts`) backs `express-rate-limit`
so memory stays `O(maxKeys)` under high-cardinality IP traffic:

- **`/api/assess`** (create): 15-min window — **30** requests for signed-in users,
  **10** for anonymous.
- **`/api/share`** (email): 10-min window — **5** requests.

## Testing

- **Unit/integration:** `tests/*.test.ts` (Node's built-in runner via
  `tsx --test`) — postcode cooldown, refresh limits, admin auth, data-quality
  flags, banner behaviour.
- **End-to-end:** `tests/*.spec.ts` are Playwright specs (`playwright.config.ts`).
  Requires `npx playwright install` for browsers.

```bash
npx tsx --test tests/postcode-cooldown.test.ts
npx playwright test tests/compare.spec.ts
```

## Project layout

```
Area-Insight/
├── client/                 # React + Vite frontend
│   └── src/pages/          # Home, Report, Compare, History, HowItWorks
├── server/
│   ├── index.ts            # Express bootstrap, helmet, logging
│   ├── routes.ts           # All API + scoring logic
│   ├── storage.ts          # Drizzle-backed data access
│   ├── rateLimits.ts       # BoundedMemoryStore + limiters
│   ├── db.ts               # Postgres pool
│   ├── data/*.json         # Council-tax & Scottish crime reference data
│   └── replit_integrations/auth/  # Replit Auth (OIDC/passport/session)
├── shared/
│   ├── schema.ts           # Drizzle models + Zod validation
│   ├── routes.ts           # API contract (Zod) shared client/server
│   └── models/auth.ts      # Users & sessions tables
├── migrations/             # Drizzle migration SQL
├── tests/                  # unit + Playwright specs
├── script/build.ts         # production build script
├── .replit / replit.nix    # Replit-native config
└── replit.md               # Replit project notes (companion doc)
```

## Security posture

- `helmet` CSP applied to all routes in production (API-only in dev);
  `frameSrc`/`frameAncestors` set to `'none'`.
- Upstream error messages sanitised before reaching clients (`safeMessage` in
  `routes.ts`) so secrets/connection strings aren't leaked.
- `SESSION_SECRET` fail-closed; cookies `httpOnly` + `secure`.
- Postcode validation is server-side (not just browser); the
  `dangerouslySetInnerHTML` XSS risk in the Police API description was replaced
  with plain text.

## Known limitations (technical)

- School scores are hardcoded 80/100 placeholders.
- Scottish safety excluded (no Police Scotland via police.uk).
- Crime is street-level only, ~1.5 km, normalised to a nominal 0.25 km² area.
- Air quality falls back to a location heuristic when no DEFRA station is found.
- EV-charger data is informational, intentionally excluded from scoring.
- Rate-limit state is in-process memory — does **not** coordinate across multiple
  server instances. Use a shared store (Redis) if running more than one process
  behind a load balancer.
