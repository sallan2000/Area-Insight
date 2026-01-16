# ScoreMyStreet

## Overview

ScoreMyStreet is a UK postcode assessment application that provides livability scores for locations. Users enter a UK postcode and receive comprehensive area assessments including safety metrics, transport accessibility, school proximity, and local amenities. The application fetches real-time data from external APIs (UK Police, postcodes.io, OpenStreetMap) to calculate 0-100 scores across multiple categories.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Build Tool**: Vite with hot module replacement
- **Animations**: Framer Motion for smooth transitions
- **Charts**: Recharts for data visualization

The frontend follows a pages-based structure under `client/src/pages/` with reusable components in `client/src/components/`. Custom hooks in `client/src/hooks/` handle API interactions and shared logic.

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod validation
- **Database ORM**: Drizzle ORM with PostgreSQL

The server uses a storage abstraction pattern (`server/storage.ts`) for database operations, making it easy to swap implementations. Routes are registered in `server/routes.ts` and handle postcode assessment creation and retrieval.

### Data Flow
1. User submits postcode on Home page
2. Backend geocodes postcode via postcodes.io API
3. Backend fetches crime data, amenities, schools, and transport from external APIs
4. Scores are calculated and stored in PostgreSQL
5. User is redirected to Report page showing assessment results

### Shared Code
The `shared/` directory contains code used by both frontend and backend:
- `schema.ts`: Drizzle database schema and Zod types
- `routes.ts`: API route definitions with request/response schemas

### Build Process
- Development: `npm run dev` runs tsx for server with Vite middleware
- Production: Custom build script (`script/build.ts`) bundles server with esbuild and client with Vite

## External Dependencies

### APIs
- **postcodes.io**: UK postcode geocoding (latitude, longitude, outcode)
- **UK Police API**: Real-time crime statistics for locations
- **OpenStreetMap Overpass API**: Amenities, schools, bus stops, train stations

### Database
- **PostgreSQL**: Primary data store via DATABASE_URL environment variable
- **Drizzle ORM**: Type-safe database queries and migrations
- **connect-pg-simple**: Session storage (if sessions are added)

### Key NPM Packages
- `@tanstack/react-query`: Async state management
- `drizzle-orm` / `drizzle-zod`: Database ORM and schema validation
- `zod`: Runtime type validation for API inputs/outputs
- `framer-motion`: Animation library
- `recharts`: Chart components for score visualization
- `lucide-react`: Icon library