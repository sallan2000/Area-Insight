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

- **School scores measure "education options" for all UK nations.** The number,
  mix and proximity of nearby schools (from OpenStreetMap) are scored for England,
  Scotland, Wales and Northern Ireland alike. England additionally gets a capped
  Ofsted quality nudge from synced ratings; the other nations use the options
  basis only (their rating feeds aren't published as comparable grades).
- **Scottish safety is scored from an annual proxy, recalibrated to the UK scale.**
  Police Scotland doesn't publish via the police.uk API, so Safety for Scottish
  postcodes uses the Scottish Government **SIMD 2020v2 Crime domain** resolved to the
  postcode's Data Zone — clearly labelled as annual, small-area statistics, not
  realtime crime. The raw SIMD crime rank is a *national deprivation percentile*,
  which (unlike the England absolute realtime score) puts the median zone at 50 and
  makes ordinary areas read as high-crime. To balance it with the rest of the UK, the
  rank is re-centred with a logistic remap anchored at the median Data Zone (median →
  78, matching the England realtime median; tails compressed to ~[60, 95]) so
  Scottish scores sit on the same practical 0–100 scale. The relative ordering is
  preserved (worst zones still score lowest) — only the centring changes.
- **Every report carries a Data Confidence band.** Each component is flagged
  `measured` (real data) or `estimated` (heuristic fallback, e.g. air quality with
  no nearby DEFRA station, or Overpass outage), and an overall high/medium/low band
  plus plain-language notes are shown in the report and email.
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
| **Static JSON** (`server/data/`) | Council-tax bands (England/Wales LSOA, Scotland council areas); Scottish SIMD 2020v2 crime proxy (`scotland-datazone-crime.json`); ground-truth reference data for validation (`imd-england.json`, `scotland-simd-rank.json`) |
| **England schools** | Synced via `npm run sync:schools` from Ofsted "Management information — state-funded schools — latest inspections" CSV (URN, phase, postcode, rating) → `server/data/schools.json` (postcodes.io geocodes each school to lat/lng) |
| **Property sales** | **England & Wales:** `npm run sync:property-sales` from **HM Land Registry Price Paid Data (PPD)** — aggregated per full postcode for the trailing 12 months → average, count, lowest/highest, and a list of individual sales (date + price + type) → `server/data/property-sales.json` (large ~200 MB file; server lazy-loads it only on first property-sales lookup, not at boot; set `PER_POSTCODE=0` for a small outcode-only file). **Scotland & Northern Ireland:** transaction-level sales are paid-only there, so instead `npm run sync:property-prices-ukhpi` pulls the **free, official UK House Price Index** average price per council area (finest free granularity) → `server/data/property-prices-ukhpi.json`. The report shows the council-area average for S/NI postcodes, **clearly labelled "by council area"** (area average, not a per-postcode list). |

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
- **Safety** for England & Wales uses live police.uk street crime (12 months, within
  1.5 km, weighted severity + crime-density, with a trend multiplier). Calibrated so
  ordinary areas score in the 70s–90s and city centres lower but not collapsed
  (severity ceiling 380, density/severity blended 0.5/0.5 — the previous settings
  over-penalised typical postcodes by ~30 points). **Scotland** has no realtime
  street-crime feed, so it uses a **proxy**: the Scottish Government **SIMD 2020v2
  Crime domain** resolved to the postcode's Data Zone (via postcodes.io `lsoa11`),
  re-centred onto the same 0–100 scale (median → 78). This is **annual, small-area
  (≈700 people) statistics — clearly labelled as not realtime** in the report and
  email. Regenerate the proxy dataset with `npm run sync:scotland-crime`.
- **Schools** measures **education options**: the number, mix and proximity of
  nearby schools (from OpenStreetMap, available for all four UK nations), so a
  Scottish, Welsh or Northern Irish postcode gets a genuine "how much choice is
  nearby" score just like England. The score blends a saturating **supply** curve
  (≈8+ schools → full marks), **phase coverage** (primary + secondary both present),
  **diversity** (distinct school types = real choice) and **proximity** (closer =
  more usable). **England only** gets a bonus quality nudge from synced Ofsted
  ratings (`server/data/schools.json`, via `npm run sync:schools`), capped at ±15 so
  it refines rather than dominates. Where no rating feed exists, the score is purely
  the options basis — no fake grades. Each matched England school's **Ofsted rating**
  is shown as a colour-coded badge (Outstanding/Good/Requires improvement/Inadequate)
  beside its name + distance in both the on-screen report and the shared/PDF export.
  Matching an OSM school to its Ofsted record is by **outcode + name** (the synced
  school's postcode outcode must match the search postcode's outcode, plus a strict
  name comparison — token overlap ≥70% or a near-complete prefix). This keeps ratings
  England-only and avoids cross-postcode collisions (e.g. two "St Mary's" schools).
- **Amenities** blends count, category diversity, top-rated count, and supermarket
  proximity.
- **Green Space & Health Access** — shown as a supplementary section (alongside
  Air Quality, Flood, Broadband and Mobile), *not* one of the four scored pillars
  and *not given a synthetic score*. Two OSM-derived signals for all UK nations:
  - *Green space*: number of green areas (parks, gardens, playgrounds, commons,
    nature reserves, woodland, public greens) within 1.5 km, plus distance to the
    nearest — counted as map **areas only** (not POI nodes), with noisy tags
    (`natural=grass/scrub/heath`, sports pitches) excluded.
  - *Health access*: number of GPs, clinics, hospitals and dentists within 3 km,
    plus distance to the nearest.
  Both are reported as plain context. Raw OSM element counts track tagging density
  rather than real greenness, so scoring them would be misleading — hence no 0–100.

**Composite weights (four core pillars):** Transport 25%, Safety 35%,
Amenities 20%, Schools 20%.

Raw metrics are stored as JSON (`rawMetrics`) so the scoring function can be
re-run or tweaked without re-fetching external data.

## Data freshness & caching

- Results cached in PostgreSQL keyed by postcode.
- A cached result is served without re-fetching if **fresh**:
  - normal assessment: created within the last **90 days**
  - otherwise the service re-fetches everything and overwrites the row.
- **Partial assessments are never served stale.** A row flagged `partialData`
  (Overpass/OSM blipped during the original computation, so transport/schools/
  amenities were computed from empty data) is treated as **never fresh** — every
  retest recomputes it. This prevents a one-off upstream outage from permanently
  sticking a postcode with empty pillars. (Previously partial rows were re-served
  within a 1-day window; that was the bug that made some Scottish postcodes look
  like they had no data even though the DB showed a partial row.)
- **The whole cache is cleared on every production boot (deploy/restart).**
  `server/index.ts` wipes all cached assessments once at startup (production only,
  fire-and-forget so a failure can't block boot). This guarantees stale/partial rows
  from a previous code version can never persist across a deploy — every postcode
  recomputes from live data on first request after a redeploy. You can also purge
  manually via `POST /api/admin/clear-cache` (requires `ADMIN_SECRET`).
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
| `GET` | `/api/admin/partial-assessments` | `ADMIN_SECRET` | List partial assessments |
| `POST` | `/api/admin/refresh-partial` | `ADMIN_SECRET` | Bulk-refresh partials |
| `POST` | `/api/admin/clear-cache` | `ADMIN_SECRET` | Wipe ALL cached assessments (forces every postcode to recompute) |

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

Reference data in `server/data/*.json` loads at startup — no env var needed.
Note the split between **committed** and **git-ignored, synced** files:

- **Committed / bundled:** council-tax bands, `imd-england.json`,
  `scotland-simd-rank.json` (validation ground truth).
- **Git-ignored / generated (NOT committed):** `schools.json` (England schools +
  Ofsted ratings) and `scotland-datazone-crime.json` (Scottish SIMD crime proxy).
  These are regenerated on Replit via `scripts/refresh-data.sh` — see
  *Data freshness & auto-refresh (Replit)* below. They must be present on the host
  or the server falls back (neutral-80 school nudge / N/A Scottish safety).

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

## Data freshness & auto-refresh (Replit)

The two synced datasets (`schools.json`, `scotland-datazone-crime.json`) are
**git-ignored** and consumed from the host's local filesystem, so they are never
shipped via git — they must be (re)generated wherever the app runs. On Replit this
is wired in two places:

1. **On every deploy / code pull.** `.replit`'s `[postMerge]` hook runs
   `scripts/post-merge.sh`, which now calls `scripts/refresh-data.sh` after
   `npm install` + `db:push`. So the data is rebuilt automatically whenever Replit
   pulls new code — it is never stale on boot.
2. **Weekly Scheduled Deployment.** Set up a Replit *Scheduled Deployment*
   (Deployments → Scheduled) whose command is `bash scripts/refresh-data.sh` on a
   weekly cron (e.g. `0 6 * * 1`, Mon 06:00). This catches upstream Ofsted/SIMD
   updates that land between deploys. The Scheduled Deployment is configured in the
   Replit UI — it is **not** set from this repo.

`scripts/refresh-data.sh` is **non-fatal per sync** (a transient upstream blip
warns but does not break the run) and has a **freshness guard**: each sync is
skipped if its output already exists and is newer than `MAX_AGE_DAYS` (default 6),
so scheduled runs don't hammer Ofsted/SIMD redundantly. `FORCE=1` forces a refresh.
Env overrides: `OFSTED_CSV_URL` (the Ofsted CSV is date-stamped — bump it when
GOV.UK publishes a newer month) and `GEOCODE=0` to skip postcode geocoding.

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

- Scottish safety uses the SIMD 2020v2 Data Zone crime proxy (annual, not realtime) —\
  scored on the same scale as England, with the caveat shown in the report/email.
- **England/Wales false-zero risk:** some dense urban postcodes (e.g. city-centre
  wards) have many of their crimes geo-coded by police.uk to a generic "Force"
  centroid *outside* the 1.5 km collection radius, so the live feed returns ~0 and
  Safety can wrongly read as 100 ("safest"). The 1.5 km filter is intentional (it
  stops force-centroid crimes from inflating everywhere else), so this is a known
  trade-off rather than a bug to "fix" by widening the radius. A proper fix needs
  neighbourhood-level crime rates. When detected (<5 crimes in 12 months) the report
  labels it `safetySource: 'policeuk-lowconfidence'` so it isn't presented as fact.
- **Northern Ireland safety is an estimated baseline, not live crime data.** PSNI
  crime statistics are not published via the police.uk API (it returns empty for NI
  postcodes), so NI no longer silently scores ~100. It uses a neutral baseline (70)
  labelled `safetySource: 'estimated-ni'`. NI council tax uses Domestic Rates (not
  VOA bands) and is shown as an estimate linked to nidirect.
- **Green & Health is OpenStreetMap-derived only.** Green space and health access
  reflect what's mapped in OSM near the postcode — a good proxy for provision, but
  not NHS service availability, waiting times, or practice registration. Health
  access is proximity/count of GPs/clinics/hospitals/dentists, not quality.
- Schools score = "education options" (count + mix + proximity of nearby schools from
  OSM), available for all UK nations. England adds a capped Ofsted quality nudge.
- Crime is street-level only, ~1.5 km, normalised to a nominal 0.25 km² area.
- Air quality falls back to a location heuristic when no DEFRA station is found.
- EV-charger data is informational, intentionally excluded from scoring.
- Rate-limit state is in-process memory — does **not** coordinate across multiple
  server instances. Use a shared store (Redis) if running more than one process
  behind a load balancer.

## Confidence bands & score validation

The composite weights and transforms are **tuning constants**, not derived from a
ground-truth regression. Two features keep the score honest:

**Data Confidence band (runtime).** Every report computes a `confidence` object:
each component is flagged `measured` (real data) or `estimated` (heuristic
fallback — e.g. air quality with no nearby DEFRA station, or an Overpass outage),
and an overall `high` / `medium` / `low` band plus plain-language notes are shown
in the report UI and the emailed/exported report. It qualifies *data quality*, not
accuracy.

**Validation against official deprivation indices.** The accepted official measure
of area liveability in GB is the **Index/SimD of Multiple Deprivation** (IMD for
England, SIMD for Scotland) — a rank per small area where rank 1 = most deprived.
`npm run validate:score` scores a curated spread of real postcodes through the live
server pipeline (`POST /api/assess`), joins each to its official IMD/SIMD rank, and
reports **Spearman's ρ** between our `overallScore` and the official inverted rank.
Use it to check and justify the composite weights (see `CONFIDENCE.md`).

```bash
npm run dev                # start the app (PORT, default 5000)
npm run validate:score     # against http://localhost:5000
# or: npm run validate:score -- --server https://your-host
```

Reference data (bundled, git-ignored, Open Government Licence):
`imd-england.json` (LSOA11 → IMD 2019 rank, MHCLG) and `scotland-simd-rank.json`
(Data Zone → SIMD 2020v2 overall rank, Scottish Government). Wales/NI are skipped
by the harness until their reference data is added.

### npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | tsx server + Vite HMR |
| `npm run build` / `npm start` | production build / serve |
| `npm run check` | `tsc` type-check |
| `npm run sync:schools` | refresh `server/data/schools.json` (England schools + Ofsted ratings, via Ofsted latest-inspections CSV) |
| `npm run sync:scotland-crime` | refresh `server/data/scotland-datazone-crime.json` (SIMD crime proxy) |
| `npm run validate:score` | correlation check vs official IMD/SIMD (requires running server) |
