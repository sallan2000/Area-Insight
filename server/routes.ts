import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, insertShareRequestSchema } from "@shared/routes";
import { assessRateLimit, shareRateLimit, REFRESH_COOLDOWN_MS } from "./rateLimits";
import { isAuthenticated } from "./replit_integrations/auth";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

// Sanitise error messages before they reach clients. Upstream provider and
// internal errors can leak secrets, connection strings, or stack detail if
// surfaced verbatim. Only expose the message when it looks like a safe,
// user-facing error; otherwise fall back to a generic string.
import { Resend } from "resend";
function safeMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message;
  if (typeof msg !== "string" || !msg) return fallback;
  const inner = msg.toLowerCase();
  const leakMarkers = [
    "secret", "password", "token", "apikey", "api_key", "key=",
    "authorization", "authorisation", "postgres", "connection",
    "etimedout", "econn", "stack", " at ", "\n",
  ];
  if (leakMarkers.some((m) => inner.includes(m))) return fallback;
  if (msg.length > 200) return fallback;
  return msg;
}

// One-time flag: log Ofcom mobile API schema once per process to confirm field names/types.
let ofcomMobileSchemaLogged = false;

let lsoaBandLookup: Record<string, string> = {};
try {
  const basePath = join(process.cwd(), 'server', 'data', 'lsoa-council-tax-bands.json');
  const distPath = join(process.cwd(), 'dist', 'data', 'lsoa-council-tax-bands.json');
  let data: string;
  try {
    data = readFileSync(basePath, 'utf-8');
  } catch {
    data = readFileSync(distPath, 'utf-8');
  }
  lsoaBandLookup = JSON.parse(data);
  console.log(`Loaded ${Object.keys(lsoaBandLookup).length} LSOA council tax band entries`);
} catch (e) {
  console.error("Failed to load LSOA council tax band data:", e);
}

type ScotCrimeEntry = { name: string; rate: number };
type ScotCrimeFile = { _meta: { year: string; scotlandAverage: number }; [key: string]: ScotCrimeEntry | { year: string; scotlandAverage: number } };

// Modal council tax band per Scottish local authority (S12000xxx codes from postcodes.io).
let scotlandCouncilBandLookup: Record<string, string> = {};
try {
  const basePath = join(process.cwd(), 'server', 'data', 'scotland-council-tax-bands.json');
  const distPath = join(process.cwd(), 'dist', 'data', 'scotland-council-tax-bands.json');
  let data: string;
  try {
    data = readFileSync(basePath, 'utf-8');
  } catch {
    data = readFileSync(distPath, 'utf-8');
  }
  scotlandCouncilBandLookup = JSON.parse(data);
  console.log(`Loaded ${Object.keys(scotlandCouncilBandLookup).length} Scottish council tax band entries`);
} catch (e) {
  console.error("Failed to load Scottish council tax band data:", e);
}

let scotlandCrimeRateLookup: Record<string, ScotCrimeEntry> = {};
let scotlandCrimeMeta = { year: "2023/24", scotlandAverage: 550 };
try {
  const basePath = join(process.cwd(), 'server', 'data', 'scotland-crime-rates.json');
  const distPath = join(process.cwd(), 'dist', 'data', 'scotland-crime-rates.json');
  let data: string;
  try {
    data = readFileSync(basePath, 'utf-8');
  } catch {
    data = readFileSync(distPath, 'utf-8');
  }
  const parsed = JSON.parse(data) as ScotCrimeFile;
  scotlandCrimeMeta = { year: parsed._meta.year, scotlandAverage: (parsed._meta as any).scotlandAverage };
  for (const [code, entry] of Object.entries(parsed)) {
    if (code !== '_meta') {
      scotlandCrimeRateLookup[code] = entry as ScotCrimeEntry;
    }
  }
  console.log(`Loaded ${Object.keys(scotlandCrimeRateLookup).length} Scottish crime rate entries`);
} catch (e) {
  console.error("Failed to load Scottish crime rate data:", e);
}

// England schools (synced via `npm run sync:schools` from DfE GIAS + Ofsted).
// Each entry: { urn, name, phase: 'primary'|'secondary', lat, lng, postcode, rating: 1..4|null, ratingScore: 100|80|50|20|null, type }
type SchoolEntry = { urn: string; name: string; phase: 'primary' | 'secondary'; lat: number; lng: number; postcode: string; rating: number | null; ratingScore: number | null; type: string; nation: string };
let schoolsLookup: SchoolEntry[] = [];
try {
  const basePath = join(process.cwd(), 'server', 'data', 'schools.json');
  const distPath = join(process.cwd(), 'dist', 'data', 'schools.json');
  let data: string;
  try {
    data = readFileSync(basePath, 'utf-8');
  } catch {
    data = readFileSync(distPath, 'utf-8');
  }
  schoolsLookup = JSON.parse(data) as SchoolEntry[];
  console.log(`Loaded ${schoolsLookup.length} England schools (${schoolsLookup.filter(s => s.ratingScore != null).length} rated)`);
} catch (e) {
  console.warn("schools.json not found — school scoring will fall back to a neutral 80 until `npm run sync:schools` is run.");
}

// Property sales (last 12 months), aggregated per postcode from HM Land Registry PPD.
// England & Wales only — Scotland (RoS) and NI (LRNI) charge for transaction-level data.
// Lazily loaded on first lookup (the file can be hundreds of MB) and cached in memory.
type PropertySale = { date: string; price: number; type: string };
type PropertySalesEntry = {
  avgPrice: number; salesCount: number; minPrice: number; maxPrice: number;
  latestDate: string | null; latestPrice: number | null; sales: PropertySale[];
};
type PropertySalesOutcodeEntry = { avgPrice: number; salesCount: number; latestDate: string | null };
type PropertySalesData = {
  generatedAt: string; source: string; coverage: string; note: string; windowMonths: number;
  cutoff: string; perPostcode: boolean;
  byPostcode: Record<string, PropertySalesEntry>;
  byOutcode: Record<string, PropertySalesOutcodeEntry>;
};
let propertySalesCache: PropertySalesData | null | undefined = undefined; // undefined = not yet attempted
function getPropertySales(): PropertySalesData | null {
  if (propertySalesCache !== undefined) return propertySalesCache;
  try {
    const basePath = join(process.cwd(), 'server', 'data', 'property-sales.json');
    const distPath = join(process.cwd(), 'dist', 'data', 'property-sales.json');
    let data: string;
    try { data = readFileSync(basePath, 'utf-8'); }
    catch { data = readFileSync(distPath, 'utf-8'); }
    propertySalesCache = JSON.parse(data) as PropertySalesData;
    console.log(`Loaded property-sales for ${Object.keys(propertySalesCache.byPostcode).length} postcodes / ${Object.keys(propertySalesCache.byOutcode).length} outcodes (${propertySalesCache.coverage}, generated ${propertySalesCache.generatedAt.slice(0, 10)})`);
  } catch (e) {
    console.warn("property-sales.json not found — Property Sales section will show 'data not available' until `npm run sync:property-sales` is run.");
    propertySalesCache = null;
  }
  return propertySalesCache;
}

// UK House Price Index (UKHPI) average price per geography — FREE, official, all-nations.
// Used to show a council-area average for Scotland/NI postcodes (where PPD per-postcode
// sales are paid-only). Keyed by ONS Area_Code (matches postcodes.io codes.council_area /
// codes.laua). Lazily loaded on first lookup.
type UkhpiEntry = { name: string; nation: string; avgPrice: number; date: string; annualChange: number | null };
type UkhpiData = { generatedAt: string; source: string; fileMonth: string; note: string; byCode: Record<string, UkhpiEntry> };
let ukhpiCache: UkhpiData | null | undefined = undefined;
function getUkhpi(): UkhpiData | null {
  if (ukhpiCache !== undefined) return ukhpiCache;
  try {
    const basePath = join(process.cwd(), 'server', 'data', 'property-prices-ukhpi.json');
    const distPath = join(process.cwd(), 'dist', 'data', 'property-prices-ukhpi.json');
    let data: string;
    try { data = readFileSync(basePath, 'utf-8'); }
    catch { data = readFileSync(distPath, 'utf-8'); }
    ukhpiCache = JSON.parse(data) as UkhpiData;
    // Index council areas by normalized name so we can match postcodes.io's
    // admin_district (which Scottish/NI postcodes expose instead of an ONS code).
    const byName: Record<string, UkhpiEntry> = {};
    for (const entry of Object.values(ukhpiCache.byCode)) {
      byName[normalizeCouncilName(entry.name)] = entry;
    }
    (ukhpiCache as any).byName = byName;
    console.log(`Loaded UKHPI for ${Object.keys(ukhpiCache.byCode).length} geographies (file ${ukhpiCache.fileMonth})`);
  } catch (e) {
    console.warn("property-prices-ukhpi.json not found — S/NI council-area prices unavailable until `npm run sync:property-prices-ukhpi` is run.");
    ukhpiCache = null;
  }
  return ukhpiCache;
}

// ---------------------------------------------------------------------------
// Normalize a council-area name for matching (lowercase, collapse whitespace,
// drop common prefixes/suffixes that differ between UKHPI and postcodes.io).
function normalizeCouncilName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\b(city of|the|county of)\b/g, "")
    .replace(/\s*(city|council|district)\s*(council|board)?\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Try council-area ONS code, then council-area NAME (postcodes.io admin_district
// for Scotland/NI has no ONS code), then nation-level code.
function ukhpiLookup(
  councilAreaCode: string | undefined,
  councilAreaName: string | undefined,
  nationCode: string | undefined,
  data: UkhpiData
): UkhpiEntry | null {
  if (councilAreaCode && data.byCode[councilAreaCode]) return data.byCode[councilAreaCode];
  if (councilAreaName) {
    const byName = (data as any).byName as Record<string, UkhpiEntry> | undefined;
    const hit = byName?.[normalizeCouncilName(councilAreaName)];
    if (hit) return hit;
  }
  if (nationCode && data.byCode[nationCode]) return data.byCode[nationCode];
  return null;
}
// Nation-level UKHPI codes (fallback when no council-area code resolves).
const NATION_CODE: Record<string, string> = { Scotland: "S92000003", "Northern Ireland": "N92000002", England: "E92000001", Wales: "W92000004" };


// crime rank, giving a real (annual, zone-level) Safety score instead of N/A.
type ScotDzCrime = { crimeRank: number; crimeRate: number | null };
let scotlandDzCrime: Record<string, ScotDzCrime> = {};
try {
  const basePath = join(process.cwd(), 'server', 'data', 'scotland-datazone-crime.json');
  const distPath = join(process.cwd(), 'dist', 'data', 'scotland-datazone-crime.json');
  let data: string;
  try {
    data = readFileSync(basePath, 'utf-8');
  } catch {
    data = readFileSync(distPath, 'utf-8');
  }
  scotlandDzCrime = JSON.parse(data) as Record<string, ScotDzCrime>;
  console.log(`Loaded ${Object.keys(scotlandDzCrime).length} Scottish Data Zone crime entries (SIMD 2020v2)`);
} catch (e) {
  console.warn("scotland-datazone-crime.json not found — Scottish Safety will fall back to N/A until `npm run sync:scotland-crime` is run.");
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance * 100) / 100; // Return precision to 2 decimal places (10m accuracy)
}

const daqiLevel = (idx: number) => idx <= 3 ? "Low" : idx <= 6 ? "Moderate" : idx <= 9 ? "High" : "Very High";
const daqiDesc = (idx: number) => idx <= 3
  ? "Air pollution is low. Enjoy your usual outdoor activities."
  : idx <= 6
  ? "Air pollution is moderate. Consider reducing strenuous outdoor activity if you experience symptoms."
  : idx <= 9
  ? "Air pollution is high. Reduce strenuous physical exertion, particularly outdoors."
  : "Air pollution is very high. Avoid strenuous activities outdoors.";
const daqiBands = (pm25: number, pm10: number, no2: number, o3: number) => {
  const pm25Index = pm25 <= 11 ? 1 : pm25 <= 23 ? 2 : pm25 <= 35 ? 3 : pm25 <= 41 ? 4 : pm25 <= 47 ? 5 : pm25 <= 53 ? 6 : pm25 <= 58 ? 7 : pm25 <= 64 ? 8 : pm25 <= 70 ? 9 : 10;
  const pm10Index = pm10 <= 16 ? 1 : pm10 <= 33 ? 2 : pm10 <= 50 ? 3 : pm10 <= 58 ? 4 : pm10 <= 66 ? 5 : pm10 <= 75 ? 6 : pm10 <= 83 ? 7 : pm10 <= 91 ? 8 : pm10 <= 100 ? 9 : 10;
  const no2Index = no2 <= 67 ? 1 : no2 <= 134 ? 2 : no2 <= 200 ? 3 : no2 <= 267 ? 4 : no2 <= 334 ? 5 : no2 <= 400 ? 6 : no2 <= 467 ? 7 : no2 <= 534 ? 8 : no2 <= 600 ? 9 : 10;
  const o3Index = o3 <= 33 ? 1 : o3 <= 66 ? 2 : o3 <= 100 ? 3 : o3 <= 120 ? 4 : o3 <= 140 ? 5 : o3 <= 160 ? 6 : o3 <= 187 ? 7 : o3 <= 213 ? 8 : o3 <= 240 ? 9 : 10;
  return Math.max(pm25Index, pm10Index, no2Index, o3Index);
};

interface ProcessElementsInput {
  elements: any[];
  overpassFailed: boolean;
  lat: number;
  lng: number;
  geoData: any;
  crimesData: any[];
  crimeCount: number;
  crimeTrend: string;
  severityScore: number;
  street: string;
  city: string;
  violentCrimes: number;
  burglaryCrimes: number;
  asbCrimes: number;
  vehicleCrimes: number;
  drugCrimes: number;
  nearestPostcodes: { label: string; postcode: string }[];
  streetName: string;
  neighbourhoodInfo: any;
  prefetchedAirQuality: any;
  airQualityEstimated: boolean;
  floodRisk: any;
  mobile: any[];
  broadband: any[];
  mobileUnavailable?: string | null;
  broadbandUnavailable?: string | null;
  evChargers: any[];
  crimeDataUnavailable: boolean;
  greenHealthFailed?: boolean;
}

// Council tax band → yearly charge estimate. There is no free per-local-authority
// charge API, so we estimate from the national average Band D council tax
// (England 2024/25, DCLG/VOA ≈ £2,171) × each band's statutory multiplier. The
// actual billed amount is set by the local authority and varies — this is a
// transparent estimate, clearly labelled as such in the UI.
const NATIONAL_AVG_BAND_D = 2171;
const BAND_MULTIPLIER: Record<string, number> = {
  A: 0.667, B: 0.778, C: 0.889, D: 1.0, E: 1.222, F: 1.444, G: 1.667, H: 1.889
};

function processElements(input: ProcessElementsInput) {
  const { elements, overpassFailed, airQualityEstimated, lat, lng, geoData, crimesData, crimeCount, crimeTrend, severityScore, street, city, violentCrimes, burglaryCrimes, asbCrimes, vehicleCrimes, drugCrimes, nearestPostcodes, streetName, neighbourhoodInfo, prefetchedAirQuality, floodRisk, mobile, broadband, mobileUnavailable, broadbandUnavailable, evChargers, crimeDataUnavailable, greenHealthFailed } = input;
  // Deduplicate and filter elements with distance
  const elementsWithDistance = elements.map((e: any) => {
    const elLat = e.lat || e.center?.lat;
    const elLon = e.lon || e.center?.lon;
    return {
      ...e,
      lat: elLat,
      lon: elLon,
      distance: (elLat && elLon) ? getDistance(lat, lng, elLat, elLon) : 999
    };
  }).sort((a: any, b: any) => a.distance - b.distance);

  const localAmenitiesElements = elementsWithDistance.filter((e: any) => e.tags?.amenity && !["school", "college", "university", "bus_stop", "pharmacy", "post_office"].includes(e.tags.amenity));
  const essentialAmenitiesElements = elementsWithDistance.filter((e: any) => ["pharmacy", "post_office"].includes(e.tags?.amenity));

  // Green space: parks, gardens, playgrounds, commons, nature reserves, woodland and
  // public greens (landuse). Count AREAS only (way/relation) — node POIs (park
  // entrances, benches) and noisy natural=grass/scrub/heath tags are excluded, since
  // raw OSM element counts are dominated by tagging density, not real greenness.
  const GREEN_AREA_TAGS = new Set(["park", "garden", "playground", "common", "nature_reserve", "dog_park", "forest"]);
  const GREEN_LANDUSE = new Set(["forest", "recreation_ground", "grass", "village_green", "meadow"]);
  const greenElements = elementsWithDistance.filter((e: any) => {
    if (e.type === "node") return false; // areas only
    if (e.tags?.leisure && GREEN_AREA_TAGS.has(e.tags.leisure)) return true;
    if (e.tags?.landuse && GREEN_LANDUSE.has(e.tags.landuse)) return true;
    if (e.tags?.natural && ["wood", "wetland", "forest"].includes(e.tags.natural)) return true;
    return false;
  });
  // Health access: GPs, hospitals, clinics, dentists (OSM). Proximity matters most.
  const healthElements = elementsWithDistance.filter((e: any) =>
    e.tags?.amenity && ["doctors", "hospital", "clinic", "dentist"].includes(e.tags.amenity)
  );

  const shopCategoryMap: Record<string, string> = {
    supermarket: "supermarket",
    convenience: "convenience_store",
    mall: "shopping_centre",
    department_store: "department_store",
    shopping_centre: "shopping_centre",
  };
  const shopElements = elementsWithDistance.filter((e: any) => e.tags?.shop && shopCategoryMap[e.tags.shop]);
  
  // Get nearest facilities
  const getNearest = (list: any[], limit: number) => {
    const unique = new Map();
    for (const item of list) {
      const name = item.tags.name || "Unnamed";
      if (!unique.has(name)) {
        // Detect hubs/terminals
        const isHub = item.tags.railway === "station" && (
          (item.tags.name || "").toLowerCase().includes("terminal") ||
          (item.tags.name || "").toLowerCase().includes("international") ||
          (item.tags.name || "").toLowerCase().includes("hub") ||
          (item.tags.station === "main")
        );
        const isBusStation = (item.tags.highway === "bus_stop" || item.tags.highway === "platform") && (
          (item.tags.name || "").toLowerCase().includes("bus station") ||
          (item.tags.name || "").toLowerCase().includes("interchange")
        );
        
        unique.set(name, { ...item, isHub: isHub || isBusStation });
      }
      if (unique.size >= limit) break;
    }
    return Array.from(unique.values())
      .filter(item => item.tags.name && item.tags.name !== "Unnamed")
      .map(item => ({
        name: item.tags.name,
        distance: item.distance,
        isHub: item.isHub
      }));
  };

  const busStopList = getNearest(elementsWithDistance.filter((e: any) => e.tags?.highway === "bus_stop" || e.tags?.highway === "platform"), 5);
  const trainStationList = getNearest(elementsWithDistance.filter((e: any) => e.tags?.railway === "station" || e.tags?.railway === "halt"), 5);

  // Schools for the "education options" metric come from OSM (works for ALL nations
  // — school locations exist everywhere, unlike ratings). Each is enriched with its
  // real Ofsted rating when present in the synced England dataset (schools.json), so
  // England gets a quality signal on top of the universal count/diversity/proximity
  // basis. We classify OSM schools by name keywords (no reliable phase tag in OSM).
  const isChildAmenity = (e: any) =>
    e.tags?.amenity === "kindergarten" || /nursery|child/i.test((e.tags?.name || "").toLowerCase());
  const isPrimaryName = (name: string) =>
    /primary|nursery|infant|junior|pre-?school|early learning|kindergarten/i.test(name);
  const isSecondaryName = (name: string) =>
    /secondary|grammar|high school|academy|senior school|upper school/i.test(name) &&
    !/sixth form college|further education|fe college/i.test(name);

  const classifyPhase = (e: any): "primary" | "secondary" | "other" => {
    const n = (e.tags?.name || "").toLowerCase();
    if (isPrimaryName(n)) return "primary";
    if (isSecondaryName(n)) return "secondary";
    if (e.tags?.amenity === "kindergarten") return "primary";
    if (e.tags?.amenity === "school") return "secondary"; // unlabelled school → broader choice
    if (isChildAmenity(e)) return "primary";
    return "other";
  };

  // Enrich an OSM school with its Ofsted rating when it matches a synced England
  // school. Matching is deliberately strict because the rating is now shown to users:
  //  - outcode backstop: the synced school's postcode outcode must equal the search
  //    postcode's outcode (free at runtime — schools.json stores the postcode), so a
  //    school in "SW1A" can never adopt a rating from an "M14" school.
  //  - name match: token-overlap (≥70% of the shorter name's tokens shared) OR one
  //    normalised name is a near-complete prefix of the other — replaces the loose
  //    12-char substring that let "St Mary's A" grab "St Mary's B".
  //  - proximity remains a tiebreaker (closest qualifying match wins).
  const searchOutcode = (geoData.result.postcode || "").replace(/\s+/g, "").toUpperCase().split(/(?=[0-9])/)[0];
  const norm = (n: string) => (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Tokenise on word boundaries of the raw name (spaces/apostrophes), NOT after
  // stripping separators — otherwise "St Mary's" collapses to one token and the
  // overlap test can never fire. Drop trivial tokens (<3 chars, e.g. the lone "s"
  // left by "St Mary's") so common fragments don't dominate the overlap score.
  const tokens = (n: string) => new Set((n || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length >= 3) || []);
  const namesMatch = (a: string, b: string): boolean => {
    const na = norm(a), nb = norm(b);
    if (na.length < 4 || nb.length < 4) return false;
    // near-complete prefix: longer name starts with ≥80% of the shorter
    const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
    if (long.startsWith(short) && short.length >= Math.ceil(long.length * 0.8)) return true;
    // token overlap: share ≥70% of the shorter name's meaningful tokens
    const ta = tokens(a), tb = tokens(b);
    if (ta.size === 0 || tb.size === 0) return false;
    let shared = 0;
    tb.forEach((t) => { if (ta.has(t)) shared++; });
    const overlap = shared / Math.min(ta.size, tb.size);
    return overlap >= 0.7;
  };
  const enrichWithRating = (s: { name: string; distance: number; phase: "primary" | "secondary"; rating?: number | null; ratingScore?: number | null }) => {
    const candidates = schoolsLookup
      .filter((x) => x.nation === "england" && x.phase === s.phase && x.name && s.name &&
        x.postcode && searchOutcode && x.postcode.replace(/\s+/g, "").toUpperCase().startsWith(searchOutcode) &&
        Math.abs(getDistance(lat, lng, x.lat, x.lng) - s.distance) < 0.15)
      .sort((a, b) => getDistance(lat, lng, a.lat, a.lng) - getDistance(lat, lng, b.lat, b.lng));
    const match = candidates.find((x) => namesMatch(x.name, s.name));
    return match ? { ...s, rating: match.rating, ratingScore: match.ratingScore } : s;
  };

  const osmSchools = elementsWithDistance.filter((e: any) =>
    e.tags?.amenity === "school" || e.tags?.amenity === "college" || e.tags?.amenity === "kindergarten"
  );
  // De-duplicate schools by identity: Overpass frequently returns the SAME physical
  // school as both a `node` (its point location) and a `way` (its building outline),
  // and POIs are sometimes repeated. Without de-duplication an area with ~13 real
  // schools can be counted as ~26, inflating the score and making the summary count
  // disagree with the rendered list. Collapse entries that share a normalised name
  // AND sit within ~40m of each other, keeping the closer one.
  const dedupeKey = (e: any) => {
    const name = (e.tags?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
    return `${name}|${Math.round((e.lat ?? 0) * 1000)}|${Math.round((e.lon ?? 0) * 1000)}`;
  };
  const seen = new Set<string>();
  const uniqueSchools: any[] = [];
  for (const s of osmSchools) {
    const key = dedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSchools.push(s);
  }
  const primarySchoolsAll = uniqueSchools
    .filter((e: any) => classifyPhase(e) === "primary")
    .map((e: any) => enrichWithRating({ name: e.tags?.name || "Unnamed", distance: e.distance, phase: "primary" as const }));
  const secondarySchoolsAll = uniqueSchools
    .filter((e: any) => classifyPhase(e) === "secondary")
    .map((e: any) => enrichWithRating({ name: e.tags?.name || "Unnamed", distance: e.distance, phase: "secondary" as const }));

  // Nearest N for display/lists
  const primarySchools = primarySchoolsAll.sort((a: any, b: any) => a.distance - b.distance).slice(0, 1000);
  const secondarySchools = secondarySchoolsAll.sort((a: any, b: any) => a.distance - b.distance).slice(0, 1000);
  
  const amenitiesList = [
    ...localAmenitiesElements
      .filter(e => e.tags.name && e.tags.name !== "Unnamed")
      .map((e: any) => ({ name: e.tags.name, category: e.tags.amenity, distance: e.distance })),
    ...essentialAmenitiesElements
      .filter(e => e.tags.name && e.tags.name !== "Unnamed")
      .map((e: any) => ({ name: e.tags.name, category: e.tags.amenity, distance: e.distance })),
    ...shopElements
      .filter((e: any) => e.tags.name && e.tags.name !== "Unnamed")
      .map((e: any) => ({ name: e.tags.name, category: shopCategoryMap[e.tags.shop], distance: e.distance }))
  ].sort((a, b) => a.distance - b.distance);

  const busStops = busStopList.length;
  const trainStations = trainStationList.length;
  const hasMajorHub = trainStationList.some(s => s.isHub) || busStopList.some(s => s.isHub);
  
  const categories = new Set(amenitiesList.map((e: any) => e.category));

  const nearestSupermarket = amenitiesList.find((e: any) => e.category === "supermarket");
  const nearestSupermarketDist = nearestSupermarket ? nearestSupermarket.distance : 5.0;
  
  // Distances and Densities
  const minTrainDist = trainStationList.length > 0 ? trainStationList[0].distance : 3.0;
  const busStopDensity = busStops / 0.38; 
  const diversityIndex = categories.size;
  const amenitiesCount = amenitiesList.length; 

  // England & Wales: use VOA LSOA lookup (E01/W01 codes from postcodes.io)
  const lsoaCode = geoData.result.codes?.lsoa || geoData.result.codes?.lsoa21 || null;
  const voaBand = lsoaCode ? lsoaBandLookup[lsoaCode] || null : null;

  // Scotland: VOA doesn't cover Scotland (SAA jurisdiction). Use modal band per Scottish
  // council area (S12000xxx code) derived from NRS Dwellings by Council Tax Band data.
  const isScotlandPostcode = geoData.result.country === 'Scotland';
  const isNIPostcode = geoData.result.country === 'Northern Ireland';
  const scotCouncilCode = geoData.result.codes?.admin_district || null;
  const scotBand = !voaBand && isScotlandPostcode && scotCouncilCode
    ? scotlandCouncilBandLookup[scotCouncilCode] || null
    : null;
  // Northern Ireland: no VOA (NI uses Domestic Rates, bands A–H, set by NISRA/LPS).
  // No open per-postcode rates dataset, so fall back to the same outcode heuristic
  // as the England estimate — clearly labelled "NISRA (NI Domestic Rates, 2024)" and
  // the value is an estimate, not a looked-up rate.
  // Outcode heuristic for NI and any unmatched postcodes (declared below as a
  // hoisted function so it can be referenced here).
  const getEstimatedBand = (outcode: string): string => {
    const highValuePrefixes = ['SW', 'W1', 'NW', 'EC', 'WC', 'SE1', 'E1W'];
    if (highValuePrefixes.some(pref => outcode.startsWith(pref))) return 'G';
    if (['N1', 'E1', 'SE', 'W2', 'W8', 'W11'].some(pref => outcode.startsWith(pref))) return 'E';
    const affluentPrefixes = ['OX', 'GU', 'RG', 'SL', 'HP', 'AL', 'SG'];
    if (affluentPrefixes.some(pref => outcode.startsWith(pref))) return 'D';
    return 'C';
  };
  const niBand = isNIPostcode ? getEstimatedBand(geoData.result.outcode) : null;

  // Scottish Safety proxy: no realtime street-crime feed exists for Scotland, so we
  // use the Scottish Government SIMD 2020v2 Crime domain — an annual, Data Zone
  // (≈700 people) measure. Resolve this postcode's Data Zone via postcodes.io
  // `codes.lsoa11` (which IS the 2011 Data Zone for Scotland) and look up its crime
  // rank (1 = most crime-deprived … ~6930 = least). Invert to a 0–100 Safety score
  // so it sits on the same scale as the England safety metric. Clearly labelled
  // "annual / zone-level" in the UI — never presented as realtime.
  let scottishSafetyScore: number | null = null;
  let scottishSafetyRank: number | null = null;
  let scottishSafetyRate: number | null = null;
  // Transparency flag: postcodes.io returns NO Data Zone (codes.lsoa11) for some
  // Scottish postcodes (e.g. G1 1AA, PA1 1AB) — they 404 / return an empty codes
  // block. There is no SIMD key to look up in that case, so Safety is genuinely
  // unavailable. Record WHY so the UI can say so honestly instead of looking broken.
  let safetyDataZoneMissing = false;
  if (isScotlandPostcode) {
    const dz = geoData.result.codes?.lsoa11 || null;
    if (!dz) {
      safetyDataZoneMissing = true;
    } else {
      const entry = scotlandDzCrime[dz];
      if (entry && entry.crimeRank) {
        scottishSafetyRank = entry.crimeRank;
        scottishSafetyRate = entry.crimeRate;
        // Crime domain rank: 1 = most crime-affected (worst safety), ~6976 = least.
        // Higher rank => safer. BUT a raw rank->0..100 linear scale is NOT comparable
        // to the England/Wales realtime safety score: the latter is an absolute
        // (sparse-crime-circle) measure that floats high (typical areas ~75–95),
        // whereas a national deprivation *percentile* puts the median Scottish zone at
        // 50 and ordinary areas at 10–50 — making Scotland read artificially dangerous.
        // So we re-centre the SIMD rank onto the England scale with a logistic remap
        // anchored at the median Data Zone rank (3488): median -> 78 (England median),
        // tails compressed to ~[60, 95]. This keeps SIMD's real relative ordering
        // (worst zones still lowest) while putting Scotland on the same practical
        // scale as the rest of the UK. Calibrated against the 6,976-entry SIMD
        // 2020v2 crime-rank distribution.
        const medianRank = 3488;
        const SIMD_SAFETY_MEDIAN = 78;
        const SIMD_SAFETY_AMP = 23;
        scottishSafetyScore = Math.round(
          Math.max(0, Math.min(100,
            SIMD_SAFETY_MEDIAN + SIMD_SAFETY_AMP * Math.tanh((entry.crimeRank - medianRank) / medianRank)
          ))
        );
      }
    }
  }

  // Crude outcode heuristic for NI and any genuinely unmatched postcodes

  const councilTaxBand = voaBand || scotBand || niBand || getEstimatedBand(geoData.result.outcode);
  const councilTaxSource = voaBand
    ? "VOA (2024)"
    : scotBand
    ? "SAA (council area, 2024)"
    : niBand
    ? "NISRA (NI Domestic Rates, 2024)"
    : "Estimated";
  const councilTaxLink = isScotlandPostcode
    ? "https://www.saa.gov.uk/"
    : isNIPostcode
    ? "https://www.nidirect.gov.uk/articles/domestic-rates"
    : "https://www.tax.service.gov.uk/check-council-tax-band/search";

  // Noise estimate (synchronous — uses elementsWithDistance from Overpass)
  const estimateNoise = () => {
    let dayDb = 45;
    const sources: string[] = [];
    const majorRoads = elementsWithDistance.filter((e: any) =>
      e.tags?.highway && ["motorway", "trunk", "primary", "motorway_link", "trunk_link"].includes(e.tags.highway)
    );
    const secondaryRoads = elementsWithDistance.filter((e: any) =>
      e.tags?.highway && ["secondary", "tertiary"].includes(e.tags.highway)
    );
    const railways = elementsWithDistance.filter((e: any) =>
      e.tags?.railway && ["rail", "light_rail", "subway", "tram"].includes(e.tags.railway)
    );
    const airports = elementsWithDistance.filter((e: any) =>
      e.tags?.aeroway && ["aerodrome", "runway", "helipad"].includes(e.tags.aeroway)
    );
    const nearestMajorRoad = majorRoads.length > 0 ? majorRoads[0].distance : Infinity;
    const nearestSecondary = secondaryRoads.length > 0 ? secondaryRoads[0].distance : Infinity;
    const nearestRailway = railways.length > 0 ? railways[0].distance : Infinity;
    const nearestAirport = airports.length > 0 ? airports[0].distance : Infinity;
    if (nearestMajorRoad < 0.1) { dayDb += 20; sources.push("Adjacent to major road"); }
    else if (nearestMajorRoad < 0.3) { dayDb += 14; sources.push(`Major road ${(nearestMajorRoad * 1000).toFixed(0)}m away`); }
    else if (nearestMajorRoad < 0.5) { dayDb += 8; sources.push(`Major road ${(nearestMajorRoad * 1000).toFixed(0)}m away`); }
    if (nearestSecondary < 0.1) { dayDb += 8; sources.push("Adjacent to secondary road"); }
    else if (nearestSecondary < 0.3) { dayDb += 4; sources.push(`Secondary road nearby`); }
    if (nearestRailway < 0.2) { dayDb += 10; sources.push(`Railway line ${(nearestRailway * 1000).toFixed(0)}m away`); }
    else if (nearestRailway < 0.5) { dayDb += 6; sources.push(`Railway ${(nearestRailway * 1000).toFixed(0)}m away`); }
    if (nearestAirport < 2) { dayDb += 12; sources.push("Near airport/aerodrome"); }
    else if (nearestAirport < 5) { dayDb += 5; sources.push("Airport within 5km"); }
    const pubBarCount = elementsWithDistance.filter((e: any) =>
      e.distance < 0.3 && e.tags?.amenity && ["pub", "bar", "nightclub"].includes(e.tags.amenity)
    ).length;
    if (pubBarCount >= 5) { dayDb += 5; sources.push(`High nightlife density (${pubBarCount} venues within 300m)`); }
    else if (pubBarCount >= 2) { dayDb += 2; sources.push(`${pubBarCount} pubs/bars within 300m`); }
    dayDb = Math.min(dayDb, 85);
    const nightDb = Math.max(25, dayDb - 12);
    const level = dayDb < 50 ? "Quiet" : dayDb < 60 ? "Moderate" : dayDb < 70 ? "Loud" : "Very Loud";
    if (sources.length === 0) sources.push("Quiet residential area");
    return { day: dayDb, night: nightDb, level, sources };
  };
  const noiseEstimate = estimateNoise();

  // Walkability / Bikeability — derived entirely from the OSM elements already
  // fetched (no extra API). Scores 0–100 using inverse-distance-to-daily-needs:
  // the closer the essentials (shops, transit, green, health, schools, amenities),
  // the higher the score. Honest: it measures *proximity of mapped features*, not a
  // validated walkability index — but it's a real, all-UK, OSM-based signal.
  const walkSat = (d: number, k: number) => Math.round(100 * (1 - Math.exp(-d / k))); // d in km
  const dShop = nearestSupermarketDist;
  const dTrain = trainStationList.length > 0 ? trainStationList[0].distance : 3.0;
  const dGreen = greenElements.length > 0 ? Math.min(...greenElements.map((g: any) => g.distance)) : 5.0;
  const dHealth = healthElements.length > 0 ? Math.min(...healthElements.map((h: any) => h.distance)) : 5.0;
  const dSchool = (primarySchools.length || secondarySchools.length)
    ? Math.min(...[...primarySchools, ...secondarySchools].map((s: any) => s.distance))
    : 5.0;
  const compShop = walkSat(dShop, 0.8);
  const compTransit = Math.round(0.6 * walkSat(dTrain, 1.2) + 0.4 * Math.min(100, (busStopDensity / 40) * 100));
  const compGreen = Math.min(100, Math.round((greenElements.length > 0 ? walkSat(dGreen, 1.0) : 0) * 0.7 + Math.min(100, greenElements.length * 8)));
  const compHealth = walkSat(dHealth, 1.0);
  const compSchool = walkSat(dSchool, 1.5);
  const compAmen = Math.min(100, Math.round(40 + diversityIndex * 4 + Math.min(40, amenitiesCount * 2)));
  const walkScore = Math.round(0.30 * compShop + 0.22 * compTransit + 0.18 * compGreen + 0.12 * compHealth + 0.10 * compSchool + 0.08 * compAmen);
  // Bikeability leans on connectivity (transit reach + amenity spread + green links).
  const bikeScore = Math.round(0.35 * compTransit + 0.30 * compAmen + 0.20 * compGreen + 0.15 * compSchool);
  const walkability = {
    score: walkScore,
    bikeScore,
    components: { shop: compShop, transit: compTransit, green: compGreen, health: compHealth, school: compSchool, amenities: compAmen },
    nearestShopKm: dShop,
    nearestGreenKm: dGreen,
    nearestHealthKm: dHealth,
    nearestSchoolKm: dSchool
  };

  // Air quality: use pre-fetched DEFRA data if available; fall back to OSM-based heuristic
  const airQuality = prefetchedAirQuality ?? (() => {
    let basePm25 = 8;
    let baseNo2 = 20;
    const isLondon = geoData.result.admin_district?.toLowerCase().includes('london') ||
      ['EC', 'WC', 'SW', 'SE', 'NW', 'NE', 'W1', 'E1', 'N1'].some((p: string) => geoData.result.outcode?.startsWith(p));
    const isMajorCity = ['manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh', 'liverpool', 'bristol', 'sheffield', 'newcastle', 'nottingham', 'cardiff', 'belfast']
      .some((c: string) => (geoData.result.admin_district || '').toLowerCase().includes(c));
    if (isLondon) { basePm25 += 6; baseNo2 += 25; }
    else if (isMajorCity) { basePm25 += 3; baseNo2 += 12; }
    const nearMajorRoad = elementsWithDistance.some((e: any) =>
      e.tags?.highway && ["motorway", "trunk", "primary"].includes(e.tags.highway) && e.distance < 0.2
    );
    if (nearMajorRoad) { basePm25 += 4; baseNo2 += 15; }
    const nearSecondary = elementsWithDistance.some((e: any) =>
      e.tags?.highway && ["secondary", "tertiary"].includes(e.tags.highway) && e.distance < 0.1
    );
    if (nearSecondary) { basePm25 += 2; baseNo2 += 5; }
    const pm25 = Math.round(basePm25 * 10) / 10;
    const no2 = Math.round(baseNo2 * 10) / 10;
    const pm10 = Math.round(pm25 * 1.5 * 10) / 10;
    const o3 = Math.round(Math.max(10, 50 - no2 * 0.3) * 10) / 10;
    const daqi = daqiBands(pm25, pm10, no2, o3);
    return {
      index: daqi, level: daqiLevel(daqi), description: daqiDesc(daqi),
      pollutants: [
        { name: "PM2.5", value: pm25, unit: "μg/m³" },
        { name: "PM10", value: pm10, unit: "μg/m³" },
        { name: "NO₂", value: no2, unit: "μg/m³" },
        { name: "O₃", value: o3, unit: "μg/m³" }
      ],
      source: "Estimated from location"
    };
  })();

  const commuteCityCenter = 45; 
  const commuteMajorHub = 30;

  // Education options: how much real choice does this postcode offer? Based on
  // the count, diversity and proximity of nearby schools (OSM — works for ALL
  // nations). England gets a bonus quality nudge from synced Ofsted ratings, but
  // the base score is identical everywhere, so a Scottish/NI/Welsh parent sees a
  // genuine "education options" assessment without needing grades that don't exist.
  const nation = geoData.result.country;
  const allNearby = [...primarySchools, ...secondarySchools];
  const schoolCount = allNearby.length;
  // Saturating count curve: 0 schools -> 0, ~8+ schools -> full marks for supply.
  const supply = Math.min(100, Math.round((1 - Math.exp(-schoolCount / 4)) * 100));
  // Diversity: mix of primary + secondary + distinct types (e.g. academy vs
  // community vs faith) => real choice, not just many identical schools.
  const hasPrimary = primarySchools.length > 0;
  const hasSecondary = secondarySchools.length > 0;
  const phaseCoverage = (hasPrimary ? 50 : 0) + (hasSecondary ? 50 : 0);
  const types = new Set(allNearby.map((s: any) => (s.type || "unknown").toLowerCase()));
  const diversity = Math.min(50, types.size * 12);
  // Proximity: closer schools are more usable options. Average distance, saturating.
  const avgDist = schoolCount > 0 ? allNearby.reduce((a: number, s: any) => a + s.distance, 0) / schoolCount : 99;
  const proximity = Math.round((1 - Math.min(1, avgDist / 3)) * 100);
  // Base "options" score: supply + diversity + proximity.
  let optionsScore = Math.round(supply * 0.45 + phaseCoverage * 0.20 + diversity * 0.15 + proximity * 0.20);
  // England-only quality nudge: if any nearby school has a real Ofsted rating,
  // blend a distance-weighted rating into the score (capped so it can't fully
  // override the options basis).
  const rated = allNearby.filter((s: any) => typeof s.ratingScore === "number");
  let qualityNudge = 0;
  if (nation === "England" && rated.length > 0) {
    let wS = 0, sS = 0;
    for (const s of rated) {
      const w = 1 / (1 + s.distance);
      wS += w; sS += w * (s.ratingScore as number);
    }
    const avgRating = wS > 0 ? sS / wS : 80;
    // Map rating (0-100) delta from neutral 80 into a +/- nudge capped at ±15.
    qualityNudge = Math.max(-15, Math.min(15, Math.round((avgRating - 80) / 80 * 15)));
  }

  // Safety data source label. Scotland -> SIMD proxy; NI -> estimated baseline;
  // England/Wales -> police.uk. If police.uk returns almost no crimes for the area
  // (<5 across 12 months within 1.5km) it usually means crimes were geo-coded to a
  // force-level centroid outside the radius (a known police.uk quirk for dense
  // urban postcodes), so the live feed is incomplete — label it low-confidence
  // rather than presenting a misleading ~100 "safest" score.
  const safetyLowConfidence = !isScotlandPostcode && !isNIPostcode && crimesData.length < 5;
  const safetySource = isScotlandPostcode
    ? (scottishSafetyScore != null ? 'simd2020' : 'none')
    : isNIPostcode
    ? 'estimated-ni'
    : (safetyLowConfidence ? 'policeuk-lowconfidence' : 'policeuk');

  const resultMetrics = {
    crimeCount,
    crimeTrend,
    safetySeverity: severityScore,
    safetySource,
    // True only when we have real, per-type police.uk incident data. Scotland (SIMD
    // proxy), Northern Ireland (estimated baseline) and missing-data cases have NO
    // specific crime-type stats, so the client must NOT show the breakdown UI or
    // any "incidents reported" wording for them.
    hasIncidentData: safetySource === 'policeuk',
    scottishSafety: scottishSafetyScore != null ? {
      score: scottishSafetyScore,
      crimeRank: scottishSafetyRank,
      crimeRate: scottishSafetyRate,
      dataZone: geoData.result.codes?.lsoa11 || null,
      year: '2020/21',
    } : (isScotlandPostcode && safetyDataZoneMissing ? {
      score: null,
      dataZone: null,
      reason: 'no-datazone', // postcodes.io returned no Data Zone for this postcode
    } : null),
    safetyBreakdown: safetySource === 'policeuk' ? {
      violent: violentCrimes,
      theft: burglaryCrimes,
      asb: asbCrimes,
      vehicle: vehicleCrimes,
      drugs: drugCrimes
    } : null,
    // Green space: reported as descriptive context (count of green areas within
    // 1.5km + distance to the nearest), NOT a synthetic 0-100. Raw OSM element counts
    // track tagging density rather than real greenness, so scoring them is misleading.
    green: (() => {
      const count = greenElements.length;
      const nearest = greenElements.length > 0 ? Math.min(...greenElements.map((g: any) => g.distance)) : null;
      return { count, nearestDistance: nearest, failed: greenHealthFailed || false };
    })(),
    // Health access: descriptive context only (count + nearest GP/clinic/hospital/
    // dentist). OSM proximity, not NHS service availability or quality.
    health: (() => {
      const count = healthElements.length;
      const nearest = healthElements.length > 0 ? Math.min(...healthElements.map((h: any) => h.distance)) : null;
      return { count, nearestDistance: nearest, failed: greenHealthFailed || false };
    })(),
    transport: {
      trainDistance: minTrainDist,
      busStopDensity,
      busStopCount: busStops,
      stationCount: trainStations,
      hasMajorHub,
      commuteCityCenter,
      commuteMajorHub,
      busStops: busStopList,
      stations: trainStationList
    },
    amenities: {
      amenitiesCount,
      diversityIndex,
      totalCount: amenitiesList.length,
      topRatedPlaces: Math.min(10, Math.floor(amenitiesList.length / 4)),
      nearestSupermarketDist,
      list: amenitiesList
    },
    schools: {
      score: Math.max(0, Math.min(100, optionsScore + qualityNudge)),
      optionsScore,
      qualityNudge,
      hasRealRatings: nation === "England" && rated.length > 0,
      count: schoolCount,
      primaryCount: primarySchools.length,
      secondaryCount: secondarySchools.length,
      avgDistanceKm: Math.round(avgDist * 100) / 100,
      primaryList: primarySchools.map((s: any) => ({ name: s.name, distance: s.distance, rating: s.rating, ratingScore: s.ratingScore })),
      secondaryList: secondarySchools.map((s: any) => ({ name: s.name, distance: s.distance, rating: s.rating, ratingScore: s.ratingScore }))
    },
    environment: {
      airQuality,
      noise: noiseEstimate,
      floodRisk
    },
    councilTax: {
      estimatedBand: councilTaxBand,
      lookupUrl: councilTaxLink,
      source: councilTaxSource,
      // Estimated yearly charge from the national average Band D (2024/25 England
      // DCLG/VOA ≈ £2,171) × this band's statutory multiplier. The actual amount is
      // set by the local authority and varies — this is a transparent estimate, not
      // the billed figure.
      estimatedAnnualCost: Math.round(NATIONAL_AVG_BAND_D * (BAND_MULTIPLIER[councilTaxBand] ?? 1)),
      nationalAvgBandD: NATIONAL_AVG_BAND_D
    },
    walkability,
    connectivity: {
      broadband: broadband,
      broadbandUnavailable: broadbandUnavailable ?? null,
      mobile: mobile,
      mobileUnavailable: mobileUnavailable ?? null,
    },
    evChargers,
    nearestPostcodes,
    neighbourhood: neighbourhoodInfo ? {
      name: neighbourhoodInfo.name,
      force: neighbourhoodInfo.url_force,
      description: neighbourhoodInfo.description,
      population: neighbourhoodInfo.population
    } : null
  };

  return {
    lat: String(lat),
    lng: String(lng),
    street: streetName || street,
    city,
    overpassFailed,
    airQualityEstimated,
    metrics: {
      ...resultMetrics,
      street: streetName || street,
      classification: geoData.result.status === "live" ? (geoData.result.admin_district || "Residential Area") : "Residential Area",
      isScotland: geoData.result.country === 'Scotland',
      isNI: geoData.result.country === 'Northern Ireland',
      nation: geoData.result.country,
      crimeDataUnavailable,
      scotCrimeContext: (() => {
        if (!crimeDataUnavailable) return null;
        const councilCode = geoData.result.codes?.admin_district;
        const entry = councilCode ? scotlandCrimeRateLookup[councilCode] : null;
        if (!entry) return null;
        return {
          council: entry.name,
          ratePerThousand: Math.round(entry.rate / 10 * 10) / 10,
          scotlandAvgPerThousand: Math.round(scotlandCrimeMeta.scotlandAverage / 10 * 10) / 10,
          year: scotlandCrimeMeta.year
        };
      })(),
      overpassFailed,
      airQualityEstimated
    },
    // ── Confidence / data-quality banding ──────────────────────────────────
    // Surfaces how much of this score rests on real measurements vs heuristics,
    // so the headline number is honestly qualified. Computed from signals already
    // collected above (no new fetches).
    confidence: (() => {
      type Q = 'measured' | 'estimated' | 'unavailable';
      const transport: Q = overpassFailed ? 'estimated' : 'measured';
      const schools: Q = overpassFailed ? 'estimated' : 'measured';
      const amenities: Q = overpassFailed ? 'estimated' : 'measured';
      const safety: Q = (safetySource === 'policeuk' || safetySource === 'simd2020')
        ? 'measured' : 'unavailable';
      const environment: Q = airQualityEstimated ? 'estimated' : (resultMetrics.environment?.airQuality?.source === 'DEFRA UK-AIR' ? 'measured' : 'estimated');
      const flags: string[] = [];
      if (overpassFailed) flags.push('Transport, schools & amenities use estimated OSM fallbacks (Overpass was unreachable).');
      if (airQualityEstimated) flags.push('Air quality is a location-based estimate (no DEFRA station nearby).');
      if (safety === 'unavailable') flags.push('Safety could not be computed for this postcode.');
      if (safetySource === 'simd2020') flags.push('Safety uses annual SIMD 2020v2 Data Zone statistics, not realtime crime.');
      const estimatedCount = [transport, schools, amenities, environment].filter(q => q === 'estimated').length;
      const overall: 'high' | 'medium' | 'low' =
        safety === 'unavailable' ? 'low'
        : estimatedCount === 0 ? 'high'
        : estimatedCount <= 2 ? 'medium'
        : 'low';
      return { overall, components: { transport, schools, amenities, safety, environment }, flags };
    })()
  };
}

// --- Live progress store for the "Analysing Area" dialog ---
// Keyed by normalized postcode. Each parallel data source in fetchAreaMetrics
// reports its completion here so the client can tick searches off in REAL TIME
// (not a fabricated timeline). Ephemeral in-memory; entries auto-expire.
export type ProgressPhase = 'pending' | 'done' | 'error';
interface ProgressState {
  phase: Record<string, ProgressPhase>;
  startedAt: number;
  cleanup?: NodeJS.Timeout;
}
const assessProgress = new Map<string, ProgressState>();

const ASSESS_PHASES = [
  'geocode', 'crime', 'overpass', 'air', 'flood', 'mobile', 'broadband', 'ev', 'nearby',
] as const;
type AssessPhase = typeof ASSESS_PHASES[number];

function initProgress(postcode: string): ProgressState {
  const key = postcode.toUpperCase();
  const existing = assessProgress.get(key);
  if (existing) return existing;
  const state: ProgressState = {
    phase: Object.fromEntries(ASSESS_PHASES.map((p) => [p, 'pending'])) as Record<AssessPhase, ProgressPhase>,
    startedAt: Date.now(),
  };
  state.cleanup = setTimeout(() => assessProgress.delete(key), 5 * 60 * 1000); // 5 min
  assessProgress.set(key, state);
  return state;
}

function setPhase(postcode: string, phase: AssessPhase, status: ProgressPhase) {
  const key = postcode.toUpperCase();
  const state = assessProgress.get(key) || initProgress(key);
  state.phase[phase] = status;
}

// Race a promise against a hard deadline. On timeout it RESOLVES to `fallback`
// (never rejects) so a slow external call degrades to its "unavailable" value
// instead of hanging the whole parallel batch. `label` is only used for logging.
// `fallback` may be a value or a thunk (lazy) — the latter is required when the
// fallback must be freshly computed (e.g. a sentinel object), since the timer
// fires after the call site has already returned.
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T | (() => T), label: string): Promise<T> {
  const resolveFallback = () => typeof fallback === 'function' ? (fallback as () => T)() : fallback;
  let to: NodeJS.Timeout;
  const timer = new Promise<T>((resolve) => {
    to = setTimeout(() => {
      console.warn(`[timeout] ${label} exceeded ${ms}ms — using fallback`);
      resolve(resolveFallback());
    }, ms);
  });
  try {
    return await Promise.race([p, timer]);
  } catch (e) {
    // A hard rejection from `p` (e.g. Overpass Promise.any throwing
    // AggregateError "All promises were rejected" when every mirror dies) must
    // ALSO degrade to the fallback, not propagate and kill the whole assessment.
    console.warn(`[timeout] ${label} rejected — using fallback:`, (e as Error)?.message || e);
    return resolveFallback();
  } finally {
    clearTimeout(to!);
  }
}

// Hard ceiling for the whole parallel data-gather phase. If any single external
// API is slow, the report still renders from whatever finished; the slow task's
// slot is filled with its existing "unavailable" fallback. Keeps one wedged
// provider (e.g. Overpass or Police UK) from killing the entire request.
//
// MUST stay at/above the Overpass per-mirror budget (runQuery uses a 35s
// AbortSignal). Overpass is the dominant cost (~17-26s for dense postcodes —
// measured 17.4s for central London) and ALL of transport / schools / amenities /
// green-space / health derive from its single core query. At the old 20s value
// Overpass routinely outran the deadline, fell back to an empty element set, and
// those pillars silently came back empty. 35s lets a healthy Overpass finish.
const PARALLEL_DEADLINE_MS = 35000;
// Longer budget for the Overpass task only: the first search after a cold boot often
// hits slow/cold mirrors, and a genuine 35 s cap would zero out green/health/amenities.
const OVERPASS_DEADLINE_MS = 60000;

// Helper function to fetch external data

// Shared Overpass mirror list — used by both fetchAreaMetrics and the cold-start
// warm-up below. The order is occasionally shuffled at call time so we don't always
// hammer the same first mirror.
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter"
];

// Cold-start resilience (Option A+C): on a freshly booted or re-woken server every
// Overpass mirror is cold and its caches are empty, so the FIRST real user search
// usually fails the OSM pillar before succeeding on later searches. Fire one
// lightweight query at boot to warm the undici connection pool + mirror caches.
// Best-effort and fire-and-forget — any failure is ignored and it never blocks
// startup or the request path.
export function warmUpOverpass(): void {
  const warmQuery =
    `[out:json][timeout:25];` +
    `(node["amenity"="cafe"](around:500,55.8263,-4.2852);node["highway"="bus_stop"](around:500,55.8263,-4.2852););out body 5;`;
  Promise.any(
    OVERPASS_ENDPOINTS.map((ep) =>
      fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ScoreMyStreet/1.0 (https://replit.com)" },
        body: `data=${encodeURIComponent(warmQuery)}`,
        signal: AbortSignal.timeout(20000),
      }).then((r) => r.json())
    )
  )
    .then(() => console.log("[boot] Overpass warm-up complete"))
    .catch(() => console.warn("[boot] Overpass warm-up skipped — mirrors still cold, first search may fall back"));
}

async function fetchAreaMetrics(postcode: string) {
  const t0 = Date.now();
  initProgress(postcode); // start ticking the "Analysing Area" dialog

  // 1. Geocode first — everything else depends on lat/lng
  const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  if (!geoRes.ok) {
    const errorBody = await geoRes.text();
    console.error(`Postcodes.io error for ${postcode}: ${geoRes.status}`, errorBody);
    setPhase(postcode, 'geocode', 'error');
    throw new Error("Invalid postcode");
  }
  const geoData = await geoRes.json();
  setPhase(postcode, 'geocode', 'done');
  console.log(`[timing] geocode phase: ${Date.now() - t0}ms`);

  const lat = geoData.result.latitude;
  const lng = geoData.result.longitude;
  const street = geoData.result.parish || geoData.result.admin_ward || "";
  const city = geoData.result.admin_district || geoData.result.parish || "";

  // --- Define all independent async tasks (all only need lat/lng/postcode from geocoding) ---

  // 2a. Overpass/OSM — each mirror races with a 35 s AbortSignal (matches
  // PARALLEL_DEADLINE_MS). A healthy Overpass finishes inside this; a wedged
  // mirror fails fast so the race falls back to a working one.
  const overpassEndpoints = OVERPASS_ENDPOINTS;
  // Two queries instead of one: the original core (transport/schools/amenities)
  // and a lighter green+health query. Splitting keeps each inside the per-mirror
  // time budget so dense English postcodes (where the combined query previously
  // timed out on all mirrors, zeroing every OSM pillar while police.uk safety
  // survived) now reliably return data. Elements are merged downstream.
  const overpassQueryCore = `
    [out:json][timeout:60];
    (
      node["amenity"~"cafe|restaurant|pub|bar|library|pharmacy|marketplace|post_office"](around:2500,${lat},${lng});
      node["amenity"="nightclub"](around:500,${lat},${lng});
      node["shop"~"supermarket|convenience|mall|department_store|shopping_centre"](around:2500,${lat},${lng});
      way["shop"~"supermarket|convenience|mall|department_store|shopping_centre"](around:2500,${lat},${lng});
      node["amenity"~"school|college|university|kindergarten"](around:3000,${lat},${lng});
      way["amenity"~"school|college|university|kindergarten"](around:3000,${lat},${lng});
      node["highway"~"bus_stop|platform"](around:2000,${lat},${lng});
      node["railway"~"station|halt"](around:5000,${lat},${lng});
      way["railway"~"station|halt"](around:5000,${lat},${lng});
      way["highway"~"residential|unclassified|tertiary|secondary|primary"](around:50,${lat},${lng});
      way["highway"~"motorway|trunk|primary|secondary|tertiary"](around:500,${lat},${lng});
      way["railway"~"rail|light_rail|subway|tram"](around:500,${lat},${lng});
      node["aeroway"~"aerodrome|helipad"](around:5000,${lat},${lng});
      way["aeroway"~"aerodrome|runway"](around:5000,${lat},${lng});
    );
    out body center;
  `;
  const overpassQueryGreen = `
    [out:json][timeout:60];
    (
      node["amenity"~"doctors|hospital|clinic|dentist"](around:3000,${lat},${lng});
      way["amenity"~"doctors|hospital|clinic|dentist"](around:3000,${lat},${lng});
      node["leisure"~"park|garden|playground|common|nature_reserve|dog_park|forest"](around:1500,${lat},${lng});
      way["leisure"~"park|garden|playground|common|nature_reserve|dog_park|forest"](around:1500,${lat},${lng});
      way["landuse"~"forest|recreation_ground|grass|village_green|meadow"](around:1500,${lat},${lng});
      node["natural"~"wood|wetland|forest"](around:1500,${lat},${lng});
      way["natural"~"wood|wetland|forest"](around:1500,${lat},${lng});
    );
    out body center;
  `;

  // Race both queries (core + green) across all mirrors. Each query runs its own
  // mirror race; if one fully fails we still keep the other's elements so a single
  // slow query can't blank every OSM pillar. Only treat Overpass as failed when
  // BOTH return empty (genuinely feature-free area or all mirrors down).
  const runQuery = async (query: string, retries = 0): Promise<any[]> => {
    const tryMirror = async (endpoint: string): Promise<any[]> => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ScoreMyStreet/1.0 (https://replit.com)' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error(`Overpass (${endpoint}): HTTP ${response.status}`);
      const data = await response.json();
      // Overpass remark when query is cut short: "runtime error: Query run time limit exceeded."
      if (data.remark && (
        data.remark.includes("exceeded") ||
        data.remark.includes("runtime error") ||
        data.remark.includes("Aborting") ||
        data.remark.includes("timeout")
      )) {
        throw new Error(`Overpass query cut short on ${endpoint}: ${data.remark.slice(0, 120)}`);
      }
      const els: any[] = data.elements || [];
      // A 0-element response is NOT treated as a failure. Overpass genuinely returns
      // an empty set for sparse areas, and rejecting it (the old behaviour) forced
      // needless mirror hops, amplified cold-start cost, and — under Promise.any — made
      // a sparse result indistinguishable from a real timeout. We only reject on a
      // true failure signal: an HTTP error, or a `remark` showing the query was cut
      // short server-side (a real timeout). A clean empty result is returned as-is and
      // downstream "BOTH queries empty" logic still flags a genuinely feature-free area.
      return els;
    };
    try {
      return await Promise.any(
        overpassEndpoints.map(ep =>
          tryMirror(ep).catch((e: any) => { console.warn(`Overpass (${ep}) failed:`, e.message); throw e; })
        )
      );
    } catch (e) {
      // One retry on the green query (it's the slower, more failure-prone half for
      // Scotland/NI where Overpass is busier). Re-shuffle mirror order to prefer a
      // different mirror first.
      if (retries <= 0) throw e;
      console.warn(`Overpass query failed all mirrors — retrying once`);
      return runQuery(query, retries - 1).catch(() => []);
    }
  };

  const fetchFromOverpass = async (): Promise<{ elements: any[]; greenFailed: boolean; coreFailed: boolean }> => {
    const tOverpass = Date.now();
    // Green query is the slower/failure-prone half (health + green tags, large radius).
    // Give it a retry so a transient Overpass timeout doesn't silently zero out
    // green space + health for an area that genuinely has them. Core gets the same
    // retry so a transient blip on every mirror can't reject Promise.any and kill
    // the whole assessment (withTimeout also degrades a hard rejection to the
    // fallback, but this keeps fetchFromOverpass itself non-throwing).
    const [core, green] = await Promise.all([
      runQuery(overpassQueryCore, 1).catch(() => []),
      runQuery(overpassQueryGreen, 1).catch(() => []),
    ]);
    const merged = [...core, ...green];
    console.log(`[timing] overpass phase: ${Date.now() - tOverpass}ms (core ${core.length} + green ${green.length} = ${merged.length} elements)`);
    return { elements: merged, coreFailed: core.length === 0, greenFailed: green.length === 0 };
  };

  // 2b. Crime — monthly fetches and neighbourhood lookup run concurrently.
  //     The 12 street-crime requests only need lat/lng, so they start immediately.
  //     locate-neighbourhood → neighbourhood runs in parallel; a 5 s timeout on the
  //     first leg means a failed/slow police API short-circuits without blocking crimes.
  //     crimes-no-location removed: those crimes have no geographic coordinates and
  //     don't improve local accuracy.
  const fetchCrimeData = async (): Promise<{ allMonthsCrimes: any[][], neighbourhoodInfo: any, lastDateStr: string }> => {
    const tCrime = Date.now();

    // Neighbourhood lookup — two sequential steps, but with a short outer timeout so a
    // slow or missing police force doesn't delay the entire crime phase.
    const neighbourhoodTask = (async (): Promise<any> => {
      try {
        const locateRes = await fetch(
          `https://data.police.uk/api/locate-neighbourhood?q=${lat},${lng}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!locateRes.ok) return null;
        const locateData = await locateRes.json();
        if (!locateData?.force || !locateData?.neighbourhood) return null;
        const hoodRes = await fetch(
          `https://data.police.uk/api/${locateData.force}/${locateData.neighbourhood}`,
          { signal: AbortSignal.timeout(5000) }
        );
        return hoodRes.ok ? await hoodRes.json() : null;
      } catch (e) {
        console.error("Neighbourhood locate failed:", e);
        return null;
      }
    })();

    // 12 monthly crime fetches — all start immediately in parallel
    const today = new Date();
    let lastDateStr = "";
    const monthPromises = Array.from({ length: 12 }, (_, idx) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (idx + 1), 1);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (idx === 11) lastDateStr = dateStr;
      return (async () => {
        try {
          const res = await fetch(
            `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${dateStr}`,
            { signal: AbortSignal.timeout(10000) }
          );
          const crimes = res.ok ? await res.json() : [];
          return (Array.isArray(crimes) ? crimes : [])
            .filter((c: any) => {
              const cLat = c.location?.latitude ? parseFloat(c.location.latitude) : lat;
              const cLng = c.location?.longitude ? parseFloat(c.location.longitude) : lng;
              return getDistance(lat, lng, cLat, cLng) <= 1.5;
            })
            .map((c: any) => {
              const cLat = c.location?.latitude ? parseFloat(c.location.latitude) : lat;
              const cLng = c.location?.longitude ? parseFloat(c.location.longitude) : lng;
              return { ...c, distance: getDistance(lat, lng, cLat, cLng) };
            });
        } catch {
          return [];
        }
      })();
    });

    const [allMonthsCrimes, neighbourhoodInfo] = await Promise.all([
      Promise.all(monthPromises),
      neighbourhoodTask
    ]);

    console.log(`[timing] crime phase: ${Date.now() - tCrime}ms`);
    return { allMonthsCrimes, neighbourhoodInfo, lastDateStr };
  };

  // 2c. Air quality (DEFRA) — returns real data or null; heuristic fallback applied later in processElements
  // Note: /stations?near= is broken (400). Working approach: /timeseries?bbox=&expanded=true,
  // then find nearest station from results. Coordinates are stored as [lat, lng] (non-standard).
  const getAirQualityFromDefra = async (): Promise<any | null> => {
    const tAq = Date.now();
    try {
      // Build a ~25 km bounding box around the postcode
      const latDelta = 0.25;
      const lngDelta = 0.35;
      const minLat = lat - latDelta, maxLat = lat + latDelta;
      const minLng = lng - lngDelta, maxLng = lng + lngDelta;
      const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;

      const res = await fetch(
        `https://uk-air.defra.gov.uk/sos-ukair/api/v1/timeseries?bbox=${bbox}&expanded=true`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        console.log(`[timing] air quality phase: ${Date.now() - tAq}ms (DEFRA HTTP ${res.status})`);
        return null;
      }

      const timeseries: any[] = await res.json();
      if (!timeseries || timeseries.length === 0) {
        console.log(`[timing] air quality phase: ${Date.now() - tAq}ms (no stations in bbox)`);
        return null;
      }

      // Each timeseries entry is a single pollutant at a single location.
      // The API assigns a unique station.properties.id per pollutant series, so we must
      // match pollutants individually and find the nearest series for each one.
      // Station label format: "{Location}-{Pollutant} (air)" — pollutant is after the last '-'.
      // Coordinates are stored as [lat, lng, alt] (non-standard GeoJSON).
      type BestEntry = { dist: number; value: number; locationName: string };
      const best: Record<string, BestEntry> = {};

      for (const ts of timeseries) {
        if (ts.lastValue?.value == null) continue;
        const sc = ts.station?.geometry?.coordinates;
        if (!sc) continue;
        const sLat = parseFloat(sc[0]);
        const sLng = parseFloat(sc[1]);
        if (isNaN(sLat) || isNaN(sLng)) continue;
        const dist = getDistance(lat, lng, sLat, sLng);

        const fullLabel: string = (ts.station?.properties?.label || "").toLowerCase();
        // Extract pollutant part (everything after the last '-')
        const pollutantPart = fullLabel.includes("-") ? fullLabel.split("-").pop()!.trim() : fullLabel;
        const uom: string = (ts.uom || "").toLowerCase();
        // CO is reported in mg/m³ — convert to μg/m³
        const val = ts.lastValue.value * (uom.startsWith("mg") ? 1000 : 1);
        // Location name is the part before the last '-'
        const locationName = fullLabel.includes("-")
          ? fullLabel.split("-").slice(0, -1).join("-").trim() : fullLabel;

        const update = (key: string) => {
          if (!best[key] || dist < best[key].dist) {
            best[key] = { dist, value: val, locationName };
          }
        };

        if (pollutantPart.includes("pm2.5") || pollutantPart.includes("pm 2.5") || pollutantPart.includes("particulate matter < 2.5")) {
          update("PM2.5");
        } else if (pollutantPart.includes("pm10") || pollutantPart.includes("pm 10") || pollutantPart.includes("particulate matter < 10")) {
          update("PM10");
        } else if (pollutantPart.includes("nitrogen dioxide") || pollutantPart.includes("no2 ") || pollutantPart.startsWith("no2")) {
          update("NO₂");
        } else if (pollutantPart.includes("ozone") || pollutantPart.startsWith("o3 ") || pollutantPart === "ozone (air)") {
          update("O₃");
        } else if (pollutantPart.includes("sulphur dioxide") || pollutantPart.includes("sulfur dioxide") || pollutantPart.includes("so2")) {
          update("SO₂");
        }
      }

      const pollutantMap: Record<string, number> = {};
      for (const [key, entry] of Object.entries(best)) {
        pollutantMap[key] = entry.value;
      }

      const pm25 = pollutantMap["PM2.5"] || 0, pm10 = pollutantMap["PM10"] || 0;
      const no2 = pollutantMap["NO₂"] || 0, o3 = pollutantMap["O₃"] || 0;
      if (pm25 > 0 || pm10 > 0 || no2 > 0 || o3 > 0) {
        const daqi = daqiBands(pm25, pm10, no2, o3);
        // Report the nearest NO₂ station name as the representative location
        const repEntry = best["NO₂"] || best["PM2.5"] || best["PM10"] || best["O₃"] || Object.values(best)[0];
        const stationName = repEntry
          ? repEntry.locationName.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : "Nearby station";
        const stationDist = repEntry?.dist ?? 0;
        console.log(`[timing] air quality phase: ${Date.now() - tAq}ms (real data, station: ${stationName}, pollutants: ${Object.keys(pollutantMap).join(",")})`);
        return {
          index: daqi, level: daqiLevel(daqi), description: daqiDesc(daqi),
          pollutants: Object.entries(pollutantMap).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10, unit: "μg/m³" })),
          station: { name: stationName, distance: stationDist },
          source: "DEFRA UK-AIR"
        };
      }
    } catch (e) { console.error("DEFRA UK-AIR fetch failed:", e); }
    console.log(`[timing] air quality phase: ${Date.now() - tAq}ms (no real data)`);
    return null;
  };

  // 2d. Flood risk (Environment Agency)
  const getFloodRisk = async (): Promise<any> => {
    const tFlood = Date.now();
    try {
      const [alertsRes, stationsRes] = await Promise.all([
        fetch(`https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat}&long=${lng}&dist=5`, { signal: AbortSignal.timeout(8000) }),
        fetch(`https://environment.data.gov.uk/flood-monitoring/id/stations?lat=${lat}&long=${lng}&dist=3&_limit=5`, { signal: AbortSignal.timeout(8000) })
      ]);
      let alertCount = 0, alertSeverity = "None";
      if (alertsRes.ok) {
        const alertData = await alertsRes.json();
        const items = alertData.items || [];
        alertCount = items.length;
        if (items.some((i: any) => i.severityLevel <= 2)) alertSeverity = "Warning";
        else if (items.length > 0) alertSeverity = "Alert";
      }
      let nearestStation: any = null, stationReading: any = null;
      if (stationsRes.ok) {
        const stationData = await stationsRes.json();
        const stations = (stationData.items || [])
          .map((s: any) => ({ ...s, _dist: (s.lat && s.long) ? getDistance(lat, lng, s.lat, s.long) : 999 }))
          .sort((a: any, b: any) => a._dist - b._dist);
        const riverStations = stations.filter((s: any) => s.riverName);
        nearestStation = riverStations.length > 0 ? riverStations[0] : (stations.length > 0 ? stations[0] : null);
        if (nearestStation) {
          try {
            const readingRes = await fetch(`${nearestStation["@id"]}/readings?_sorted&_limit=1`, { signal: AbortSignal.timeout(5000) });
            if (readingRes.ok) {
              const readingData = await readingRes.json();
              if (readingData.items?.length > 0) stationReading = { value: readingData.items[0].value, dateTime: readingData.items[0].dateTime };
            }
          } catch {}
        }
      }
      const stationDist = nearestStation ? nearestStation._dist : null;
      let likelihood: string, description: string;
      if (alertSeverity === "Warning") { likelihood = "High"; description = `Active flood warnings within 5km. ${alertCount} alert(s) in the area.`; }
      else if (alertSeverity === "Alert") { likelihood = "Medium"; description = `${alertCount} flood alert(s) within 5km. Monitor local conditions.`; }
      else if (nearestStation && stationDist !== null && stationDist < 0.5) { likelihood = "Low"; description = `Close to ${nearestStation.riverName || "a watercourse"} (${(stationDist * 1000).toFixed(0)}m). No current alerts.`; }
      else if (nearestStation && stationDist !== null && stationDist < 1.5) { likelihood = "Very Low"; description = `${nearestStation.riverName || "Watercourse"} is ${stationDist.toFixed(1)}km away. No current alerts.`; }
      else { likelihood = "Very Low"; description = "No watercourses or flood monitoring stations nearby. Very low flood risk."; }
      return {
        likelihood,
        suitability: likelihood === "High" ? "Check local guidance" : likelihood === "Medium" ? "Moderate" : "High",
        description,
        station: nearestStation ? { name: nearestStation.label || nearestStation.stationReference, river: nearestStation.riverName || null, distance: stationDist, latestReading: stationReading } : null,
        activeAlerts: alertCount, source: "Environment Agency"
      };
    } catch (e) { console.error("Flood risk fetch failed:", e); }
    console.log(`[timing] flood phase: ${Date.now() - tFlood}ms (fallback)`);
    return { likelihood: "Very Low", suitability: "High", description: "Flood risk data unavailable. Assumed very low risk.", station: null, activeAlerts: 0, source: "Estimated" };
  };

  // 2e. Mobile coverage (Ofcom Connected Nations).
  // Ofcom's APIM subscription key is ONE key for both mobile + broadband. We read
  // it from OFCOM_API_KEY, allowing OFCOM_BROADBAND_API_KEY as an optional
  // per-endpoint override. (Requiring two separate secrets was a footgun: setting
  // only one in Replit Secrets left the other half silently empty.)
  const getOfcomKey = (override?: string): string | null => {
    const k = override || process.env.OFCOM_API_KEY || process.env.OFCOM_BROADBAND_API_KEY;
    return k && k.trim() ? k.trim() : null;
  };
  const getMobileCoverage = async (): Promise<{ data: any[]; unavailable: string | null }> => {
    const tMobile = Date.now();
    try {
      const apiKey = getOfcomKey();
      if (!apiKey) {
        console.error("[Ofcom Mobile] OFCOM_API_KEY environment variable is not set — mobile coverage unavailable.");
        return { data: [], unavailable: "Ofcom API key not configured" };
      }
      const cleanPostcode = geoData.result.postcode.replace(/\s+/g, "").toUpperCase();
      const res = await fetch(`https://api-proxy.ofcom.org.uk/mobile/coverage/${cleanPostcode}`, { headers: { "Ocp-Apim-Subscription-Key": apiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) { console.error(`[Ofcom Mobile] API HTTP ${res.status}`); return { data: [], unavailable: `Ofcom API error (${res.status})` }; }
      const data = await res.json();
      const addresses: any[] = data?.Availability || [];
      if (addresses.length === 0) { console.log(`[timing] mobile coverage phase: ${Date.now() - tMobile}ms (no addresses)`); return { data: [], unavailable: null }; }
      if (!ofcomMobileSchemaLogged) {
        ofcomMobileSchemaLogged = true;
        const sample = Object.fromEntries(Object.entries(addresses[0]).filter(([k]) => k !== "UPRN" && k !== "PostCode" && k !== "AddressShortDescription"));
        console.log("[Ofcom Mobile] field schema sample (one-time):", JSON.stringify(sample));
      }
      const ops = [{ name: "EE", prefix: "EE" }, { name: "Vodafone", prefix: "VO" }, { name: "O2", prefix: "TF" }, { name: "Three", prefix: "H3" }];
      const covered = (field: string) => { const total = addresses.length; if (total === 0) return false; return addresses.filter((a) => (a[field] ?? 0) > 0).length / total >= 0.5; };
      const result = ops.map(({ name, prefix }) => ({ name, data4GOutdoor: covered(`${prefix}DataOutdoor`), data4GIndoor: covered(`${prefix}DataIndoor`) }));
      console.log(`[timing] mobile coverage phase: ${Date.now() - tMobile}ms`);
      return { data: result, unavailable: null };
    } catch (e) { console.error("Mobile coverage fetch failed:", e); console.log(`[timing] mobile coverage phase: ${Date.now() - tMobile}ms (failed)`); return { data: [], unavailable: "fetch failed" }; }
  };

  // 2f. Broadband (Ofcom)
  const getBroadbandAvailability = async (): Promise<{ data: any[]; unavailable: string | null }> => {
    const tBroadband = Date.now();
    try {
      const apiKey = getOfcomKey(process.env.OFCOM_BROADBAND_API_KEY);
      if (!apiKey) { console.error("[Ofcom Broadband] OFCOM_API_KEY environment variable is not set — broadband unavailable."); return { data: [], unavailable: "Ofcom API key not configured" }; }
      const cleanPostcode = geoData.result.postcode.replace(/\s+/g, "").toUpperCase();
      const res = await fetch(`https://api-proxy.ofcom.org.uk/broadband/coverage/${cleanPostcode}`, { headers: { "Ocp-Apim-Subscription-Key": apiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) { console.error(`[Ofcom Broadband] API HTTP ${res.status}`); return { data: [], unavailable: `Ofcom API error (${res.status})` }; }
      const data = await res.json();
      const addresses: any[] = data?.Availability || [];
      if (addresses.length === 0) { console.log(`[timing] broadband phase: ${Date.now() - tBroadband}ms (no addresses)`); return { data: [], unavailable: null }; }
      const maxOf = (field: string) => addresses.reduce((max: number, a: any) => Math.max(max, a[field] ?? 0), 0);
      const result = [
        { type: "Standard",  downField: "MaxBbPredictedDown",   upField: "MaxBbPredictedUp" },
        { type: "Superfast", downField: "MaxSfbbPredictedDown", upField: "MaxSfbbPredictedUp" },
        { type: "Ultrafast", downField: "MaxUfbbPredictedDown", upField: "MaxUfbbPredictedUp" },
      ].map(({ type, downField, upField }) => { const maxDownMbps = maxOf(downField); return { type, maxDownMbps, maxUpMbps: maxOf(upField), available: maxDownMbps > 0 }; });
      console.log(`[timing] broadband phase: ${Date.now() - tBroadband}ms`);
      return { data: result, unavailable: null };
    } catch (e) { console.error("Broadband availability fetch failed:", e); console.log(`[timing] broadband phase: ${Date.now() - tBroadband}ms (failed)`); return { data: [], unavailable: "fetch failed" }; }
  };

  // 2g. EV chargers (OpenChargeMap)
  const getEvChargers = async (): Promise<any[]> => {
    const tEv = Date.now();
    try {
      const apiKey = process.env.OPENCHARGEMAP_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`https://api.openchargemap.io/v3/poi/?output=json&countrycode=GB&maxresults=5&latitude=${lat}&longitude=${lng}&distance=10&distanceunit=KM&key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json();
      const result = (data || []).map((poi: any) => ({
        name: poi.AddressInfo?.Title || "Unknown", town: poi.AddressInfo?.Town || "",
        distance: poi.AddressInfo?.Distance ? Math.round(poi.AddressInfo.Distance * 100) / 100 : null,
        operator: poi.OperatorInfo?.Title || "Unknown",
        numberOfPoints: poi.NumberOfPoints || poi.Connections?.reduce((sum: number, c: any) => sum + (c.Quantity || 1), 0) || 1,
        usageCost: poi.UsageCost || null,
        connections: (poi.Connections || []).map((c: any) => ({ type: c.ConnectionType?.Title || "Unknown", level: c.Level?.Title || "", powerKW: c.PowerKW || null, quantity: c.Quantity || 1 }))
      }));
      console.log(`[timing] EV chargers phase: ${Date.now() - tEv}ms`);
      return result;
    } catch (e) { console.error("EV charger fetch failed:", e); console.log(`[timing] EV chargers phase: ${Date.now() - tEv}ms (failed)`); return []; }
  };

  // 2h. Nearest postcodes (shown in UI as "Nearby Neighbourhoods").
  //
  // PRIMARY: /postcodes/{pc}/nearest — postcodes.io ranks neighbouring UNIT
  // postcodes by true straight-line distance from the searched point, so these
  // are genuinely the streets next door (e.g. EH1 1EG -> EH1 1JX @32m, EH1 2EX
  // @40m), not a far-away district centroid.
  //
  // FALLBACK: the outcode-centroid method is kept only when /nearest yields too
  // few distinct results — it's less relevant (a neighbour district's centroid can
  // be hundreds of metres away, and its reverse-geocode sometimes 404s, e.g. DG11)
  // but it's better than an empty list. Empirically /nearest 404s for a few
  // Scottish/NI postcodes and returns only the same-building unit in dense areas
  // like SW1A, so the fallback fills those gaps.
  const pcNearest = async (): Promise<{ label: string; postcode: string }[]> => {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}/nearest?limit=12`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const data = await res.json();
      const outcode = geoData.result.outcode;
      const rows = (data.result || [])
        .map((r: any) => ({ pc: r.postcode as string, distance: typeof r.distance === "number" ? r.distance : null }))
        .filter((r: any) => r.pc && r.pc !== postcode && r.pc.replace(/\s+/g, "").toUpperCase() !== postcode.replace(/\s+/g, "").toUpperCase())
        // Prefer postcodes in the SAME outcode (truly the local neighbourhood)
        // first; others follow. Keeps the list geographically tight.
        .sort((a: any, b: any) => {
          const ao = a.pc.split(" ")[0] === outcode ? 0 : 1;
          const bo = b.pc.split(" ")[0] === outcode ? 0 : 1;
          return ao - bo;
        })
        .slice(0, 5)
        .map((r: any) => ({ label: r.pc, postcode: r.pc, distance: r.distance }));
      return rows;
    } catch {
      return [];
    }
  };

  const outcodeFallback = async (): Promise<{ label: string; postcode: string }[]> => {
    try {
      const outcode = geoData.result.outcode;
      if (!outcode) return [];
      const nearestRes = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}/nearest?limit=8`, { signal: AbortSignal.timeout(8000) });
      if (!nearestRes.ok) return [];
      const nearestData = await nearestRes.json();
      const outcodes = (nearestData.result || [])
        .map((o: any) => o.outcode)
        .filter((oc: string) => oc && oc !== outcode)
        .slice(0, 6);
      // Reverse-geocode each district centroid to a real postcode (parallel).
      const results = await Promise.all(outcodes.map(async (oc: string) => {
        try {
          const ocRes = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(oc)}`, { signal: AbortSignal.timeout(8000) });
          if (!ocRes.ok) return null;
          const ocData = await ocRes.json();
          const { latitude, longitude } = ocData.result || {};
          if (latitude == null || longitude == null) return null;
          // Compute the true straight-line distance (metres) from the searched
          // point to this district centroid, so every suggested neighbourhood
          // carries a distance consistent with the primary /nearest rows (which
          // postcodes.io returns in metres). Without this, fallback rows showed
          // no distance and the list looked inconsistent.
          const km = getDistance(lat, lng, latitude, longitude);
          const pcRes = await fetch(`https://api.postcodes.io/postcodes?lon=${longitude}&lat=${latitude}&limit=1`, { signal: AbortSignal.timeout(8000) });
          if (!pcRes.ok) return null;
          const pcData = await pcRes.json();
          const pc = pcData.result?.[0]?.postcode;
          if (!pc) return null;
          return { label: pc, postcode: pc, distance: Math.round(km * 1000) };
        } catch {
          return null;
        }
      }));
      return results.filter((r: any): r is { label: string; postcode: string } => r !== null).slice(0, 5);
    } catch {
      return [];
    }
  };

  const fetchNearest = async (): Promise<{ label: string; postcode: string }[]> => {
    const tNearest = Date.now();
    try {
      const primary = await pcNearest();
      // If /nearest gave us too few (404, or just the same-building unit in dense
      // areas), top up from the outcode-centroid fallback so the list isn't empty
      // or a single item.
      if (primary.length < 3) {
        const fallback = await outcodeFallback();
        const seen = new Set(primary.map((p) => p.postcode));
        for (const f of fallback) {
          if (!seen.has(f.postcode)) { primary.push(f); seen.add(f.postcode); }
          if (primary.length >= 5) break;
        }
      }
      console.log(`[timing] nearest postcodes phase: ${Date.now() - tNearest}ms (${primary.length} neighbours)`);
      // Every row now carries a distance (primary from postcodes.io /nearest in
      // metres; fallback computed from the district centroid). Sort nearest-first
      // so the suggestion chips are geographically ordered and consistent.
      return primary.sort((a: any, b: any) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    } catch {
      console.log(`[timing] nearest postcodes phase: ${Date.now() - tNearest}ms (failed)`);
      return [];
    }
  };

  // 3. Run all tasks in parallel — nothing below depends on another until all complete
  const tParallel = Date.now();
  // Each task is individually wrapped with a per-task timeout so a fast task keeps
  // its real result even if one sibling is wedged. On its own deadline it degrades
  // to that task's "unavailable" fallback; the global PARALLEL_DEADLINE_MS below is
  // a backstop for the (rare) case where several are slow at once.
  const parallelTasks = [
    withTimeout(fetchFromOverpass().then((r) => { setPhase(postcode, 'overpass', 'done'); return r; }),
      OVERPASS_DEADLINE_MS,
      () => { setPhase(postcode, 'overpass', 'error'); return { elements: [], greenFailed: true, coreFailed: true }; },
      'overpass'),
    withTimeout(fetchCrimeData().then((r) => { setPhase(postcode, 'crime', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'crime', 'error'); return null; },
      'crime'),
    withTimeout(fetchNearest().then((r) => { setPhase(postcode, 'nearby', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'nearby', 'error'); return []; },
      'nearby'),
    withTimeout(getAirQualityFromDefra().then((r) => { setPhase(postcode, 'air', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'air', 'error'); return null; },
      'air'),
    withTimeout(getFloodRisk().then((r) => { setPhase(postcode, 'flood', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'flood', 'error'); return null; },
      'flood'),
    withTimeout(getMobileCoverage().then((r) => { setPhase(postcode, 'mobile', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'mobile', 'error'); return { data: [], unavailable: 'timeout' }; },
      'mobile'),
    withTimeout(getBroadbandAvailability().then((r) => { setPhase(postcode, 'broadband', 'done'); return r as any; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'broadband', 'error'); return { data: [], unavailable: 'timeout' }; },
      'broadband'),
    withTimeout(getEvChargers().then((r) => { setPhase(postcode, 'ev', 'done'); return r; }),
      PARALLEL_DEADLINE_MS,
      () => { setPhase(postcode, 'ev', 'error'); return []; },
      'ev'),
  ];
  const [
    overpassResult,
    crimeResult,
    nearestPostcodes,
    prefetchedAirQuality,
    floodRisk,
    mobileWrapped,
    broadbandWrapped,
    evChargers,
  ] = await Promise.all(parallelTasks);
  console.log(`[timing] parallel phase total: ${Date.now() - tParallel}ms`);

  // Ofcom functions now return { data, unavailable } so we can tell the UI whether a
  // blank result means "genuinely no coverage here" vs "data source unavailable".
  const mobile = mobileWrapped.data;
  const broadband = broadbandWrapped.data;
  const mobileUnavailable = mobileWrapped.unavailable;
  const broadbandUnavailable = broadbandWrapped.unavailable;

  // `overpassFailed` (both queries empty) means genuinely no OSM data at all.
  // A *green-only* failure (common for Scotland/NI where Overpass is busier) must
  // also be treated as partial so the row is never cached as "fresh" with silently
  // zeroed green space + health. See processElements usage of greenFailed below.
  const overpassFailed = overpassResult.elements.length === 0;
  const greenHealthFailed = overpassResult.greenFailed;
  const airQualityEstimated = prefetchedAirQuality === null;

  // 4. Post-parallel processing

  // Extract street name from Overpass elements
  let streetName = street;
  const streetEls = (overpassResult.elements as any[]).filter((e: any) => e.tags?.highway && e.tags?.name);
  if (streetEls.length > 0) {
    const closest = streetEls.map((e: any) => {
      const elLat = e.lat || e.center?.lat; const elLon = e.lon || e.center?.lon;
      return { name: e.tags.name, distance: getDistance(lat, lng, elLat, elLon) };
    }).sort((a: any, b: any) => a.distance - b.distance)[0];
    if (closest) streetName = closest.name;
  }

  // Crime processing
  const { allMonthsCrimes, neighbourhoodInfo, lastDateStr } = crimeResult;
  let crimesData: any[] = allMonthsCrimes.flat();

  // Scotland: Police Scotland does not publish data via the police.uk API, so the
  // live street-crime feed is empty. We instead use the SIMD 2020v2 Data Zone crime
  // proxy (loaded from scotland-datazone-crime.json). Only flag "unavailable" when
  // that proxy dataset itself failed to load — otherwise Scotland gets a real score.
  const isScotland = geoData.result.country === 'Scotland';
  const scotlandProxyAvailable = Object.keys(scotlandDzCrime).length > 0;
  const crimeDataUnavailable = isScotland && !scotlandProxyAvailable;
  if (isScotland && !scotlandProxyAvailable) {
    console.log("Scottish postcode detected but SIMD crime dataset missing — marking Safety as unavailable.");
  } else if (isScotland) {
    console.log("Scottish postcode detected — using SIMD 2020v2 Data Zone crime proxy for Safety.");
  }

  // Area normalisation
  const POSTCODE_AREA_KM2 = 0.25;
  let effectiveCoverageArea = POSTCODE_AREA_KM2, areaNormalisationFactor = 1.0;
  if (!isScotland && crimesData.length > 5) {
    const clats: number[] = [], clngs: number[] = [];
    for (const c of crimesData) {
      const cLat = c.location?.latitude ? parseFloat(c.location.latitude) : null;
      const cLng = c.location?.longitude ? parseFloat(c.location.longitude) : null;
      if (cLat !== null && cLng !== null) { clats.push(cLat); clngs.push(cLng); }
    }
    if (clats.length > 5) {
      const latSpanKm = (Math.max(...clats) - Math.min(...clats)) * 111.32;
      const lngSpanKm = (Math.max(...clngs) - Math.min(...clngs)) * 111.32 * Math.cos(((Math.min(...clats) + Math.max(...clats)) / 2) * Math.PI / 180);
      effectiveCoverageArea = Math.max(latSpanKm * lngSpanKm * 0.7, POSTCODE_AREA_KM2);
      areaNormalisationFactor = Math.min(1.0, POSTCODE_AREA_KM2 / effectiveCoverageArea);
    }
  }

  const rawCrimeCount = crimesData.length;
  const crimeCount = Math.round(rawCrimeCount * areaNormalisationFactor);
  const recent6Months = Math.round(allMonthsCrimes.slice(0, 6).reduce((acc: number, m: any) => acc + m.length, 0) * areaNormalisationFactor);
  const older6Months = Math.round(allMonthsCrimes.slice(6, 12).reduce((acc: number, m: any) => acc + m.length, 0) * areaNormalisationFactor);
  const crimeTrend = recent6Months < older6Months ? "down" : (recent6Months > older6Months ? "up" : "stable");

  const rawViolent = crimesData.filter((c: any) => c.category === 'violent-crime' || c.category === 'robbery' || c.category === 'possession-of-weapons' || c.category === 'violence-and-sexual-offences').length;
  const rawBurglary = crimesData.filter((c: any) => c.category === 'burglary' || c.category === 'theft-from-the-person' || c.category === 'shoplifting').length;
  const rawAsb = crimesData.filter((c: any) => c.category === 'anti-social-behaviour' || c.category === 'public-order').length;
  const rawVehicle = crimesData.filter((c: any) => c.category === 'vehicle-crime').length;
  const rawDrug = crimesData.filter((c: any) => c.category === 'drugs').length;

  const violentCrimes = Math.round(rawViolent * areaNormalisationFactor);
  const burglaryCrimes = Math.round(rawBurglary * areaNormalisationFactor);
  const asbCrimes = Math.round(rawAsb * areaNormalisationFactor);
  const vehicleCrimes = Math.round(rawVehicle * areaNormalisationFactor);
  const drugCrimes = Math.round(rawDrug * areaNormalisationFactor);

  const regionalMultiplier = isScotland ? 1.3 : 1.0;
  const severityScore = ((violentCrimes * 5) + (burglaryCrimes * 3) + (asbCrimes * 1) + (vehicleCrimes * 2) + (drugCrimes * 2)) * regionalMultiplier;

  console.log(`Safety normalisation: ${geoData.result.postcode} | raw=${rawCrimeCount} normalised=${crimeCount} | area=${effectiveCoverageArea.toFixed(2)}km² factor=${areaNormalisationFactor.toFixed(4)} | severity=${severityScore.toFixed(0)}`);
  console.log(`fetchAreaMetrics: ${geoData.result.postcode} completed in ${Date.now() - t0}ms`);

  return processElements({
    elements: overpassResult.elements, overpassFailed, airQualityEstimated, lat, lng, geoData,
    crimesData, crimeCount, crimeTrend, severityScore,
    street, city, violentCrimes, burglaryCrimes, asbCrimes, vehicleCrimes, drugCrimes,
    nearestPostcodes, streetName, neighbourhoodInfo,
    prefetchedAirQuality, floodRisk, mobile, broadband, evChargers,
    mobileUnavailable, broadbandUnavailable,
    crimeDataUnavailable, greenHealthFailed
  });
}

// Scoring Logic
function calculateScores(metrics: any, isScotland: boolean, isNI: boolean) {
  const normalize = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    return Math.min(100, Math.max(0, 100 * ((val - min) / (max - min))));
  };

  // --- Transport ---
  const transportNoData = (metrics.transport.stations?.length ?? 0) === 0 && (metrics.transport.busStopCount ?? 0) === 0;
  const t1 = metrics.transport.stations.length === 0 ? 0 : 100 - normalize(metrics.transport.trainDistance || 3, 0, 5);
  const t2 = metrics.transport.busStopCount === 0 ? 0 : normalize(metrics.transport.busStopDensity, 0, 30);
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  const transportScoreFinalRaw = (metrics.transport.stations.length === 0 && metrics.transport.busStopCount === 0) ? 0 : (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;
  const transportScoreFinal = metrics.transport.hasMajorHub ? transportScoreFinalRaw * 1.2 : transportScoreFinalRaw;

  // --- Safety ---
  // England/Wales with an empty crime feed must NOT read as "perfectly safe";
  // treat a zero-count result (and the established unavailable flags) as no data.
  const safetyNoData = !!metrics.crimeDataUnavailable || (!isScotland && !isNI && (metrics.crimeCount ?? 0) === 0);
  const severityCeiling = isScotland ? 150 : 380;
  const severityPoints = normalize(metrics.safetySeverity, 0, severityCeiling);
  const densityMultiplier = isScotland ? 1.0 : 0.8;
  const crimeDensity = (metrics.crimeCount / 3.14) * densityMultiplier;
  const densityCeiling = isScotland ? 300 : 500;
  const crimeDensityPoints = normalize(crimeDensity, 0, densityCeiling);
  // England/Wales safety: blend crime density (0.5) and weighted severity (0.5).
  // Severity ceiling raised 200->380 and the severity weight eased 0.6->0.5 so that
  // ordinary areas are not over-penalised (the old settings knocked ~35 pts off a
  // typical postcode). Calibrated against real police.uk data for a spread of
  // English postcodes (median landed ~77, suburbs 85-95, city centres lower but
  // not collapsed). Scotland uses the SIMD proxy; Northern Ireland has no realtime
  // PSNI feed via police.uk (it returns empty), so it gets a neutral baseline rather
  // than a misleading ~100 — clearly labelled 'estimated-ni' in safetySource.
  const scottishProxy = isScotland && metrics.scottishSafety?.score != null ? metrics.scottishSafety.score : null;
  let safetyBase: number;
  if (scottishProxy != null) {
    safetyBase = scottishProxy;
  } else if (isNI) {
    // No live crime feed for NI. Use a neutral baseline so the area is neither
    // falsely safest nor falsely dangerous; the UI labels it as estimated.
    safetyBase = 70;
  } else if (safetyNoData) {
    // Empty feed (or failed lookup) — neutral baseline, NOT a perfect 100.
    safetyBase = 70;
  } else {
    safetyBase = 100 - (crimeDensityPoints * 0.5) - (severityPoints * 0.5);
  }
  const trendMultiplier = metrics.crimeTrend === 'down' ? 1.1 : (metrics.crimeTrend === 'up' ? 0.8 : 1.0);
  const safetyScoreFinal = Math.min(100, Math.max(0, Math.round(safetyBase * trendMultiplier)));

  // --- Amenities ---
  const a1 = normalize(metrics.amenities.amenitiesCount, 0, 40);
  const a2 = normalize(metrics.amenities.diversityIndex, 0, 12);
  const a3 = normalize(metrics.amenities.topRatedPlaces, 0, 10);
  const supermarketProximity = 100 - normalize(metrics.amenities.nearestSupermarketDist || 5, 0, 3);
  const amenitiesScoreFinal = (a1 * 0.4 + a2 * 0.25 + a3 * 0.15 + supermarketProximity * 0.2);

  // --- Schools ---
  // A missing schools result (no nearby schools OR lookup failed) is "no data",
  // not a worst-possible 0/100 that drags the composite down.
  const schoolsNoData = (metrics.schools.count ?? 0) === 0;
  const schoolsScoreFinal = schoolsNoData ? null : (metrics.schools.score ?? null);

  // --- Green & Health are reported as descriptive context only (counts + nearest
  // distance), not scored — raw OSM element counts track tagging density rather
  // than real greenness/health access, so a synthetic 0-100 would be misleading.
  // They do not enter the headline composite (the four core pillars only):
  // transport .25, safety .35, amenities .20, schools .20.

  // --- Composite: renormalise across pillars that actually have data. ---
  // Missing pillars are excluded (not filled with a 0 or 100), so thin data never
  // silently distorts the headline. Neutral-fill only happens inside the per-pillar
  // formulae above (e.g. empty crime feed -> 70 baseline) so an excluded pillar is
  // never scored as an extreme.
  const NEUTRAL = 70;
  const pillars: { key: string; weight: number; score: number | null; available: boolean }[] = [
    { key: "transport", weight: 0.25, score: transportNoData ? null : Math.round(transportScoreFinal), available: !transportNoData },
    { key: "safety", weight: 0.35, score: safetyNoData ? null : Math.round(safetyScoreFinal), available: !safetyNoData },
    { key: "amenities", weight: 0.20, score: Math.round(amenitiesScoreFinal), available: true },
    { key: "schools", weight: 0.20, score: schoolsScoreFinal, available: !schoolsNoData },
  ];
  const available = pillars.filter((p) => p.available && p.score != null);
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  // If everything failed (shouldn't happen), fall back to neutral so we never divide by 0.
  const safeWeight = totalWeight > 0 ? totalWeight : 1;
  const rawComposite = available.reduce((s, p) => s + p.score! * p.weight, 0) / safeWeight;
  // Safety uses a sqrt transform in the headline; preserve that for available safety.
  let totalScore = rawComposite;
  if (available.some((p) => p.key === "safety")) {
    // Recompute with the sqrt transform applied only to the safety pillar.
    const others = available.filter((p) => p.key !== "safety");
    const othersWeight = others.reduce((s, p) => s + p.weight, 0);
    const safetyPillar = pillars.find((p) => p.key === "safety")!;
    const safetyContribution = Math.sqrt(safetyPillar.score!) * 10 * safetyPillar.weight;
    const othersContribution = others.reduce((s, p) => s + p.score! * p.weight, 0);
    totalScore = (safetyContribution + othersContribution) / safeWeight;
  }

  return {
    transport: Math.round(transportScoreFinal),
    safety: Math.round(safetyScoreFinal),
    amenities: Math.round(amenitiesScoreFinal),
    schools: schoolsScoreFinal == null ? 0 : Math.round(schoolsScoreFinal),
    greenHealth: null,
    total: Math.round(totalScore),
    dataCoverage: {
      pillarsAvailable: available.length,
      pillarsTotal: pillars.length,
      availableKeys: available.map((p) => p.key),
    },
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const UK_POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;

  app.get("/api/postcodes/:postcode/validate", async (req, res) => {
    const raw = req.params.postcode?.trim().toUpperCase();
    if (!raw || !UK_POSTCODE_REGEX.test(raw)) {
      return res.status(422).json({ valid: false, message: "Invalid UK postcode format." });
    }
    try {
      const upstream = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!upstream.ok) {
        return res.status(404).json({ valid: false, message: "Postcode not found." });
      }
      return res.json({ valid: true });
    } catch {
      return res.status(502).json({ valid: false, message: "Unable to verify postcode." });
    }
  });

  app.get("/api/property-sales", async (req, res) => {
    const raw = String(req.query.postcode || "").trim().toUpperCase();
    if (!raw || !/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(raw)) {
      return res.status(422).json({ available: false, message: "Invalid UK postcode format." });
    }
    try {
      const geo = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`, { signal: AbortSignal.timeout(8000) });
      if (!geo.ok) return res.status(404).json({ available: false, message: "Postcode not found." });
      const geoJson = await geo.json() as any;
      const country = geoJson?.result?.country as string | undefined;
      const outcode = (geoJson?.result?.outcode as string | undefined) || raw.split(" ")[0];
      const fullPc = (geoJson?.result?.postcode as string | undefined) || raw.replace(/\s+/g, " ").toUpperCase();
      const codes = geoJson?.result?.codes || {};
      const adminDistrict = geoJson?.result?.admin_district as string | undefined;
      // ONS geography codes that map to UKHPI Area_Code:
      //   Scotland -> codes.council_area (S12xxxx); NI -> codes.laua (N09xxxx).
      // postcodes.io does NOT expose these ONS codes for Scottish/NI postcodes
      // (codes.council_area / laua come back null), but it DOES give admin_district
      // (the council name, e.g. "City of Edinburgh"), which we match by name.
      const councilAreaCode = codes.council_area || codes.laua || undefined;
      const councilAreaName = adminDistrict || undefined;

      // Scotland (RoS) and NI (LRNI) charge for transaction-level data. We therefore
      // cannot show a per-postcode sales LIST for free — but UKHPI (free, official)
      // publishes a council-area AVERAGE price. Show that, clearly labelled.
      if (country === "Scotland" || country === "Northern Ireland") {
        const ukhpi = getUkhpi();
        const nationCode = NATION_CODE[country as string];
        const entry = ukhpi ? ukhpiLookup(councilAreaCode, councilAreaName, nationCode, ukhpi) : null;
        if (entry) {
          // Resolve the UKHPI Area_Code that actually matched (code, name, or nation).
          let resolvedCode = (councilAreaCode && ukhpi?.byCode[councilAreaCode]) ? councilAreaCode : null;
          if (!resolvedCode) {
            for (const [k, v] of Object.entries(ukhpi?.byCode || {})) {
              if (v === entry) { resolvedCode = k; break; }
            }
          }
          if (!resolvedCode) resolvedCode = nationCode;
          return res.json({
            available: true,
            country,
            coverage: "United Kingdom (UK HPI)",
            postcode: fullPc,
            byCouncilArea: true,
            councilArea: entry.name,
            councilAreaCode: resolvedCode,
            avgPrice: entry.avgPrice,
            date: entry.date,
            annualChange: entry.annualChange,
            source: ukhpi?.source,
            generatedAt: ukhpi?.generatedAt,
            note: "UK House Price Index average for the council area — the average at council/area level, shown when postcode-specific sales information is not available. This is an area average, not a list of individual sales.",
          });
        }
        // UKHPI data not loaded — honest fallback.
        return res.json({
          available: false,
          country,
          coverage: "England & Wales",
          message: "Council-area average price (UK HPI) is not loaded. Run `npm run sync:property-prices-ukhpi`.",
        });
      }

      const data = getPropertySales();
      if (!data) {
        return res.json({ available: false, message: "Property sales data not loaded. Run `npm run sync:property-sales`." });
      }

      // Preferred: exact postcode (with and without space, normalised).
      const keysToTry = [fullPc, fullPc.replace(" ", ""), raw.replace(/\s+/g, " ").toUpperCase(), raw.replace(/\s+/g, "").toUpperCase()];
      let entry: PropertySalesEntry | undefined;
      for (const k of keysToTry) { const e = data.byPostcode[k]; if (e) { entry = e; break; } }

      if (entry) {
        return res.json({
          available: true,
          coverage: data.coverage,
          postcode: fullPc,
          outcode,
          found: true,
          perPostcode: true,
          avgPrice: entry.avgPrice,
          salesCount: entry.salesCount,
          minPrice: entry.minPrice,
          maxPrice: entry.maxPrice,
          latestDate: entry.latestDate,
          latestPrice: entry.latestPrice,
          sales: entry.sales,
          windowMonths: data.windowMonths,
          source: data.source,
          generatedAt: data.generatedAt,
          note: data.note,
        });
      }

      // Fallback: district (outcode) summary — still real, just less granular.
      const ocEntry = data.byOutcode[outcode];
      if (ocEntry) {
        return res.json({
          available: true,
          coverage: data.coverage,
          postcode: fullPc,
          outcode,
          found: true,
          perPostcode: false,
          avgPrice: ocEntry.avgPrice,
          salesCount: ocEntry.salesCount,
          latestDate: ocEntry.latestDate,
          windowMonths: data.windowMonths,
          source: data.source,
          generatedAt: data.generatedAt,
          note: data.note + " ( District-level average shown — no individual sales recorded for this exact postcode in the last 12 months.)",
        });
      }

      return res.json({
        available: true,
        coverage: data.coverage,
        postcode: fullPc,
        outcode,
        found: false,
        message: `No recorded sales in ${outcode} in the last ${data.windowMonths} months.`,
        source: data.source,
        generatedAt: data.generatedAt,
      });
    } catch {
      return res.status(502).json({ available: false, message: "Unable to look up property sales." });
    }
  });

  app.post(api.assess.create.path, assessRateLimit, async (req, res) => {
    try {
      const { postcode } = api.assess.create.input.parse(req.body);
      const cleanPostcode = postcode.trim().toUpperCase();

      if (!UK_POSTCODE_REGEX.test(cleanPostcode)) {
        return res.status(422).json({ message: "Invalid UK postcode format. Please enter a valid postcode (e.g. SW1A 1AA)." });
      }

      const cached = await storage.getAssessmentByPostcode(cleanPostcode);
      
      const userId = (req.user as any)?.claims?.sub || null;
      
      if (cached) {
        // A "partial" row means the original computation was incomplete (e.g. the
        // Overpass layer blipped and transport/schools/amenities were computed from
        // empty data). Serving that stale empty result back on every retest is the
        // bug — it makes a postcode look like it has NO data when it actually does.
        // Treat a partial row as NEVER fresh: always recompute so the next response
        // reflects whatever the external services return right now.
        if (!cached.partialData) {
          const ninetyDaysInMs = 90 * 24 * 60 * 60 * 1000;
          const createdAt = cached.createdAt ? new Date(cached.createdAt).getTime() : 0;
          const isFresh = (Date.now() - createdAt) < ninetyDaysInMs;

          if (isFresh) {
            await Promise.all([
              storage.updateLastSearchedAt(cached.id),
              userId ? storage.recordUserSearch(userId, cached.id) : Promise.resolve(),
            ]);
            return res.status(200).json(cached);
          }

          if (cached.lastRefreshedAt) {
            const elapsed = Date.now() - new Date(cached.lastRefreshedAt).getTime();
            if (elapsed < REFRESH_COOLDOWN_MS) {
              await Promise.all([
                storage.updateLastSearchedAt(cached.id),
                userId ? storage.recordUserSearch(userId, cached.id) : Promise.resolve(),
              ]);
              return res.status(200).json(cached);
            }
          }
        } else {
          console.log(`[cache] ${cleanPostcode} has partial data — recomputing instead of serving stale empty result`);
        }
      }

      // Overall request ceiling. The parallel phase already self-limits at
      // PARALLEL_DEADLINE_MS; this guards the slower tail (geocode, scoring, DB
      // writes) so a wedged upstream can never hang the connection past ~70s (raised from
  // 45 s to accommodate the longer cold-start Overpass budget above).
      // On breach we return 504 with a retry hint rather than failing silently.
      const OVERALL_DEADLINE_MS = 70000;
      const compute = (async () => {
        const data = await fetchAreaMetrics(cleanPostcode);
        const scores = calculateScores(data.metrics, data.metrics.isScotland, data.metrics.isNI);
        const partialData = data.overpassFailed || (data.metrics.green && data.metrics.green.failed) || (data.metrics.health && data.metrics.health.failed) || false;
        return storage.createAssessment({
          postcode: cleanPostcode,
          lat: data.lat,
          lng: data.lng,
          rawMetrics: { ...data.metrics, street: data.street, city: data.city },
          scores: scores,
          partialData
        }, cached?.id);
      })();
      const assessment = await Promise.race([
        compute,
        new Promise<any>((_, reject) => {
          setTimeout(() => reject(new Error("overall-timeout")), OVERALL_DEADLINE_MS);
        }),
      ]).catch((e: any) => {
        if (e?.message === "overall-timeout") {
          return res.status(504).json({ message: "This area is taking longer than usual to analyse. Please retry in a moment." });
        }
        throw e;
      });
      // If the deadline rejected, we already responded 504 — stop here.
      if (!assessment) return;
      if (userId) {
        await storage.recordUserSearch(userId, assessment.id);
      }
      res.status(201).json(assessment);
    } catch (e: any) {
      res.status(400).json({ message: safeMessage(e, "Failed to fetch data") });
    }
  });

  app.get(api.assess.get.path, async (req, res) => {
    const assessment = await storage.getAssessmentByToken(req.params.token);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
    res.json(assessment);
  });

  // Live progress for the "Analysing Area" dialog: which data-source searches have
  // completed. Keyed by normalized postcode. Returns { phase: {name: 'pending'|'done'|'error'} }.
  // Purely supplementary — the report still loads from /api/assess regardless.
  app.get("/api/assess/progress/:postcode", (req, res) => {
    const key = String(req.params.postcode || "").trim().toUpperCase();
    if (!key) return res.status(400).json({ message: "Missing postcode" });
    const state = assessProgress.get(key);
    res.json({ phase: state ? state.phase : {} });
  });

  app.post("/api/assess/token/:token/refresh", assessRateLimit, async (req, res) => {
    try {
      const userId = (req.user as any)?.claims?.sub || null;
      if (!userId) return res.status(401).json({ message: "You must be signed in to refresh a report." });

      const token = req.params.token;
      const existing = await storage.getAssessmentByToken(token);
      if (!existing) return res.status(404).json({ message: "Assessment not found" });

      const now = Date.now();
      if (existing.lastRefreshedAt) {
        const elapsed = now - existing.lastRefreshedAt.getTime();
        if (elapsed < REFRESH_COOLDOWN_MS) {
          const retryAfterMs = REFRESH_COOLDOWN_MS - elapsed;
          const minutesLeft = Math.ceil(retryAfterMs / 60000);
          return res.status(429).json({
            message: `This report was refreshed recently. Please wait ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""} before refreshing again.`,
            retryAfterMs,
          });
        }
      }

      const data = await fetchAreaMetrics(existing.postcode);
      const scores = calculateScores(data.metrics, data.metrics.isScotland, data.metrics.isNI);
      const partialData = data.overpassFailed || (data.metrics.green && data.metrics.green.failed) || (data.metrics.health && data.metrics.health.failed) || false;
      const updated = await storage.createAssessment({
        postcode: existing.postcode,
        lat: data.lat,
        lng: data.lng,
        rawMetrics: { ...data.metrics, street: data.street, city: data.city },
        scores,
        partialData
      }, existing.id, true);

      await storage.recordUserSearch(userId, existing.id);

      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: safeMessage(e, "Failed to refresh assessment") });
    }
  });

  app.get("/api/my-assessments", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const results = await storage.getAssessmentsByUser(userId);
      res.json(results);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch assessments" });
    }
  });

  app.post("/api/share", shareRateLimit, async (req, res) => {
    try {
      const data = insertShareRequestSchema.parse(req.body);
      const assessment = await storage.getAssessment(data.assessmentId as number);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "Email sending is not configured. Please add a RESEND_API_KEY secret to enable this feature." });
      }

      const resend = new Resend(apiKey);
      const scores = assessment.scores as any;
      const raw = assessment.rawMetrics as any;
      const safetyExcluded = !!(raw?.crimeDataUnavailable);
      // Use the precomputed total (the four core pillars). Fall back to a recompute
      // only when scores.total is missing; that fallback also uses the 4-pillar
      // weighting (green & health is a supplementary section, not in the headline).
      const overallScore = safetyExcluded && scores.total == null
        ? Math.round((scores.transport * (25 / 65)) + (scores.amenities * (20 / 65)) + (scores.schools * (20 / 65)))
        : Math.round(scores.total ?? (
            (0.25 * scores.transport) + (0.35 * Math.sqrt(scores.safety) * 10) + (0.20 * scores.amenities) + (0.20 * scores.schools)
          ));
      const reportUrl = `${req.protocol}://${req.get('host')}/report/${assessment.id}`;
      const dataDate = assessment.createdAt
        ? new Date(assessment.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : "Unknown";

      const scoreColor = (s: number) => s >= 80 ? "#10b981" : s >= 60 ? "#3b82f6" : s >= 40 ? "#eab308" : "#ef4444";
      const scoreGrade = (s: number) => s >= 80 ? "Outstanding" : s >= 60 ? "Good" : s >= 40 ? "Average" : "Poor";

      const categoryRows = [
        { label: "🚌 Transport", score: Math.round(scores.transport) },
        { label: "🛡️ Safety", score: safetyExcluded ? null : Math.round(scores.safety), source: raw?.safetySource },
        { label: "🎓 Schools", score: Math.round(scores.schools) },
        { label: "🛒 Amenities", score: Math.round(scores.amenities) },
      ].map(({ label, score, source }) => score === null
        ? `<tr><td style="padding:8px 12px;color:#6b7280;">${label}</td><td style="padding:8px 12px;text-align:right;color:#9ca3af;font-style:italic;">N/A (data unavailable)</td></tr>`
        : `<tr><td style="padding:8px 12px;color:#374151;">${label}${source === 'simd2020' ? ' <span style="font-size:10px;color:#9ca3af;">(SIMD 2020)</span>' : source === 'estimated-ni' ? ' <span style="font-size:10px;color:#9ca3af;">(estimated NI)</span>' : source === 'policeuk-lowconfidence' ? ' <span style="font-size:10px;color:#9ca3af;">(low confidence)</span>' : ''}</td><td style="padding:8px 12px;text-align:right;font-weight:700;color:${scoreColor(score)};">${score}/100 — ${scoreGrade(score)}</td></tr>`
      ).join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1e40af;padding:28px 32px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#93c5fd;text-transform:uppercase;margin-bottom:6px;">ScoreMyStreet</div>
      <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">${assessment.postcode}</div>
      <div style="font-size:13px;color:#bfdbfe;margin-top:4px;">Liveability Report</div>
    </div>
    <div style="padding:28px 32px;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;font-weight:900;color:${scoreColor(overallScore)};line-height:1;">${overallScore}</div>
        <div style="font-size:14px;font-weight:700;color:${scoreColor(overallScore)};margin-top:4px;">${scoreGrade(overallScore)}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Overall Liveability Score</div>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Category</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Score</th>
          </tr>
        </thead>
        <tbody>${categoryRows}</tbody>
      </table>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:24px;">Data as of ${dataDate}</div>
      <a href="${reportUrl}" style="display:block;background:#1e40af;color:#ffffff;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">View Full Report →</a>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center;">
      Sent via ScoreMyStreet · Data from UK Police API, OpenStreetMap, DEFRA &amp; Ofcom
    </div>
  </div>
</body>
</html>`;

      const fromAddress = process.env.RESEND_FROM_EMAIL || "ScoreMyStreet <onboarding@resend.dev>";
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: [data.email as string],
        subject: `Your ScoreMyStreet report for ${assessment.postcode} — ${overallScore}/100`,
        html,
      });

      if (error) {
        console.error("[Resend] Email send error:", error);
        return res.status(502).json({ message: "Failed to send email. Please try again." });
      }

      const shareRequest = await storage.createShareRequest(data);
      res.status(201).json(shareRequest);
    } catch (err) {
      console.error("[/api/share]", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  function requireAdmin(req: any, res: any, next: any) {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(403).json({ message: "Admin access is not configured on this server." });
    }
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== adminSecret) {
      return res.status(401).json({ message: "Invalid or missing admin secret." });
    }
    next();
  }

  app.get("/api/admin/partial-assessments", requireAdmin, async (_req, res) => {
    try {
      const partials = await storage.getPartialAssessments();
      res.json({
        count: partials.length,
        assessments: partials.map(a => ({
          id: a.id,
          postcode: a.postcode,
          partialData: a.partialData,
          lastSearchedAt: a.lastSearchedAt,
          createdAt: a.createdAt,
          shareToken: a.shareToken,
        })),
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to list partial assessments." });
    }
  });

  app.post("/api/admin/refresh-partial", requireAdmin, async (req, res) => {
    try {
      const rawLimit = req.query.limit;
      const limit = rawLimit !== undefined ? Math.max(1, parseInt(String(rawLimit), 10) || 1) : undefined;

      const allPartials = await storage.getPartialAssessments();
      if (allPartials.length === 0) {
        return res.json({ message: "No partial assessments found.", refreshed: 0, failed: 0, remaining: 0, results: [] });
      }

      const batch = limit !== undefined ? allPartials.slice(0, limit) : allPartials;
      const remaining = allPartials.length - batch.length;

      const results: Array<{ id: number; postcode: string; status: string; error?: string }> = [];

      for (const assessment of batch) {
        try {
          const data = await fetchAreaMetrics(assessment.postcode);
          const scores = calculateScores(data.metrics, data.metrics.isScotland, data.metrics.isNI);
          const partialData = data.overpassFailed || (data.metrics.green && data.metrics.green.failed) || (data.metrics.health && data.metrics.health.failed) || false;
          await storage.createAssessment(
            {
              postcode: assessment.postcode,
              lat: data.lat,
              lng: data.lng,
              rawMetrics: { ...data.metrics, street: data.street, city: data.city },
              scores,
              partialData,
            },
            assessment.id
          );
          results.push({ id: assessment.id, postcode: assessment.postcode, status: partialData ? "still-partial" : "refreshed" });
        } catch (err: any) {
          results.push({ id: assessment.id, postcode: assessment.postcode, status: "failed", error: safeMessage(err, "Unknown error") });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const refreshed = results.filter(r => r.status === "refreshed").length;
      const stillPartial = results.filter(r => r.status === "still-partial").length;
      const failed = results.filter(r => r.status === "failed").length;
      const message = remaining > 0
        ? `Batch complete. ${remaining} partial assessment(s) still queued — call again to continue.`
        : "Bulk refresh complete.";

      res.json({ message, refreshed, stillPartial, failed, remaining, results });
    } catch (err) {
      res.status(500).json({ message: "Bulk refresh failed." });
    }
  });

  // Wipe ALL cached assessments so every postcode recomputes from live data.
  // Intended to be called on deploy (via scripts/post-merge.sh) so stale/partial
  // rows from a previous code version can never persist. Guarded by ADMIN_SECRET.
  app.post("/api/admin/clear-cache", requireAdmin, async (_req, res) => {
    try {
      const result = await storage.clearAllAssessments();
      console.log(`[clear-cache] wiped ${result.deletedAssessments} assessments (${result.deletedUserSearches} user-search links)`);
      res.json({ message: "Assessment cache cleared.", ...result });
    } catch (err) {
      res.status(500).json({ message: "Failed to clear cache." });
    }
  });

  return httpServer;
}
