# ScoreMyStreet

## Overview

ScoreMyStreet is a UK postcode assessment application that provides livability scores for locations. Users enter a UK postcode and receive comprehensive area assessments including safety metrics, transport accessibility, school proximity, and local amenities. The application fetches real-time data from external APIs (UK Police, postcodes.io, OpenStreetMap) to calculate 0-100 scores across multiple categories.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Authentication
- **Replit Auth** (OpenID Connect) supporting Google, GitHub, X, Apple, and email/password
- Auth setup in `server/replit_integrations/auth/` (OIDC, passport, session storage)
- Schema for users & sessions in `shared/models/auth.ts`
- Frontend hook: `client/src/hooks/use-auth.ts`
- UserMenu component in `client/src/components/UserMenu.tsx` (shown on all pages)
- Login: `/api/login`, Logout: `/api/logout`, User info: `/api/auth/user`
- Assessments have an optional `userId` column linking searches to logged-in users
- `/api/my-assessments` returns a user's search history
- `/history` page shows past searches for authenticated users

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Build Tool**: Vite with hot module replacement
- **Animations**: Framer Motion for smooth transitions
- **Charts**: Recharts for data visualization
- **Maps**: Leaflet (loaded from CDN) via `LockedMap` component (zoom only, no panning)
- **Export**: html-to-image + jsPDF for image/PDF export; social sharing via window.open URLs

The frontend follows a pages-based structure under `client/src/pages/` with reusable components in `client/src/components/`. Custom hooks in `client/src/hooks/` handle API interactions and shared logic.

Pages: Home (`/`), Report (`/report/:id`), Compare (`/compare`), HowItWorks (`/how-it-works`), History (`/history`)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod validation
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Sessions**: express-session with connect-pg-simple (PostgreSQL-backed)

The server uses a storage abstraction pattern (`server/storage.ts`) for database operations, making it easy to swap implementations. Routes are registered in `server/routes.ts` and handle postcode assessment creation and retrieval.

### Data Flow
1. User submits postcode on Home page
2. Backend geocodes postcode via postcodes.io API
3. Backend fetches crime data, amenities, schools, and transport from external APIs
4. Scores are calculated and stored in PostgreSQL (with userId if logged in)
5. User is redirected to Report page showing assessment results

### Shared Code
The `shared/` directory contains code used by both frontend and backend:
- `schema.ts`: Drizzle database schema and Zod types (re-exports `models/auth.ts`)
- `models/auth.ts`: Users and sessions tables for Replit Auth
- `routes.ts`: API route definitions with request/response schemas

### Build Process
- Development: `npm run dev` runs tsx for server with Vite middleware
- Production: Custom build script (`script/build.ts`) bundles server with esbuild and client with Vite

## External Dependencies

### APIs
- **postcodes.io**: UK postcode geocoding (latitude, longitude, outcode, LSOA codes)
- **UK Police API**: Real-time crime statistics for locations
- **OpenStreetMap Overpass API**: Amenities (cafés, restaurants, pubs, libraries, pharmacies), retail (supermarkets, convenience stores, shopping centres, department stores), schools, bus stops, train stations, major roads/railways/airports (for noise estimation)
- **DEFRA UK-AIR API**: Air quality monitoring stations and pollutant readings (with location-based heuristic fallback)
- **Environment Agency Flood Monitoring API**: Flood alerts (5km radius), river/sea monitoring stations (3km), latest water levels

### Static Data Files
- **`server/data/lsoa-council-tax-bands.json`**: 35,672 LSOA-to-modal-council-tax-band mappings from VOA CTSOP1.1 (2024). Loaded at server startup. Provides accurate council tax band estimates based on the most common band in each Lower Super Output Area. Falls back to outcode-based heuristic for Scottish postcodes or unmatched LSOAs.

### Environmental Quality Data
- **Air Quality**: Proper UK DAQI (1-10 scale) using DEFRA bands for PM2.5, PM10, NO₂, O₃. Primary source: DEFRA UK-AIR nearest station. Fallback: location-based heuristic estimating pollutant levels from urban classification and proximity to major roads
- **Noise Estimation**: OSM proximity analysis — base 45 dB (quiet residential) with increments for motorways (+20 dB within 100m), A-roads (+14 dB), railways (+10 dB), airports (+12 dB), nightlife density (+5 dB). Night = day - 12 dB. Classifications: Quiet (<50), Moderate (50-60), Loud (60-70), Very Loud (>70)
- **Flood Risk**: Combines EA active flood alerts + nearest monitoring station proximity + river name/level. Levels: Very Low / Low / Medium / High. Includes station name, river, distance, and latest water level reading

### Database
- **PostgreSQL**: Primary data store via DATABASE_URL environment variable
- **Drizzle ORM**: Type-safe database queries and migrations
- **connect-pg-simple**: PostgreSQL-backed session storage for Replit Auth

### Key NPM Packages
- `@tanstack/react-query`: Async state management
- `drizzle-orm` / `drizzle-zod`: Database ORM and schema validation
- `zod`: Runtime type validation for API inputs/outputs
- `framer-motion`: Animation library
- `recharts`: Chart components for score visualization
- `lucide-react`: Icon library
- `html-to-image` / `jspdf`: Export reports as image/PDF
- `passport` / `openid-client`: Authentication via Replit Auth OIDC