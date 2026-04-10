import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, insertShareRequestSchema } from "@shared/routes";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

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

// Helper function to calculate distance between two points in km using Haversine formula
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

function processElements(elements: any[], lat: number, lng: number, geoData: any, crimesData: any[], crimeCount: number, crimeTrend: string, severityScore: number, street: string, city: string, violentCrimes: number, burglaryCrimes: number, asbCrimes: number, vehicleCrimes: number, drugCrimes: number, nearestPostcodes: string[], streetName: string, neighbourhoodInfo: any, prefetchedAirQuality: any, floodRisk: any, mobile: any[], broadband: any[], evChargers: any[]) {
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
  
  const allSchools = elementsWithDistance.filter((e: any) => e.tags?.amenity === "school" || e.tags?.amenity === "college" || e.tags?.amenity === "university" || e.tags?.amenity === "kindergarten");
  
  const primaryKeywords = ["primary", "nursery", "infant", "junior", "pre-school", "pre school", "early learning", "kindergarten"];
  
  const primarySchools = getNearest(allSchools.filter((s: any) => {
    const name = (s.tags.name || "").toLowerCase();
    return primaryKeywords.some(k => name.includes(k));
  }), 1000);

  const secondarySchools = getNearest(allSchools.filter((s: any) => {
    const name = (s.tags.name || "").toLowerCase();
    return !primaryKeywords.some(k => name.includes(k));
  }), 1000);
  
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

  const lsoaCode = geoData.result.codes?.lsoa || geoData.result.codes?.lsoa21 || null;
  const voaBand = lsoaCode ? lsoaBandLookup[lsoaCode] || null : null;

  const getEstimatedBand = (outcode: string) => {
    const highValuePrefixes = ['SW', 'W', 'NW', 'EC', 'WC', 'SE1', 'E1W'];
    if (highValuePrefixes.some(pref => outcode.startsWith(pref))) return 'G';
    if (['N', 'E', 'S', 'W'].some(pref => outcode.startsWith(pref))) return 'E';
    const affluentPrefixes = ['OX', 'GU', 'RG', 'SL', 'HP', 'AL', 'SG'];
    if (affluentPrefixes.some(pref => outcode.startsWith(pref))) return 'D';
    return 'C';
  };

  const councilTaxBand = voaBand || getEstimatedBand(geoData.result.outcode);
  const councilTaxSource = voaBand ? "VOA (2024)" : "Estimated";
  const councilTaxLink = geoData.result.country === 'Scotland' 
    ? "https://www.saa.gov.uk/" 
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

  const resultMetrics = {
    crimeCount,
    crimeTrend,
    safetySeverity: severityScore,
    safetyBreakdown: {
      violent: violentCrimes,
      theft: burglaryCrimes,
      asb: asbCrimes,
      vehicle: vehicleCrimes,
      drugs: drugCrimes
    },
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
      primaryRating: 80,
      secondaryRating: 80,
      count: primarySchools.length + secondarySchools.length,
      primaryList: primarySchools,
      secondaryList: secondarySchools
    },
    environment: {
      airQuality,
      noise: noiseEstimate,
      floodRisk
    },
    councilTax: {
      estimatedBand: councilTaxBand,
      lookupUrl: councilTaxLink,
      source: councilTaxSource
    },
    connectivity: {
      broadband: broadband,
      mobile: mobile
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
    metrics: {
      ...resultMetrics,
      street: streetName || street,
      classification: geoData.result.status === "live" ? (geoData.result.admin_district || "Residential Area") : "Residential Area",
      isScotland: geoData.result.country === 'Scotland'
    }
  };
}

// Helper function to fetch external data
async function fetchAreaMetrics(postcode: string) {
  const t0 = Date.now();

  // 1. Geocode first — everything else depends on lat/lng
  const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  if (!geoRes.ok) {
    const errorBody = await geoRes.text();
    console.error(`Postcodes.io error for ${postcode}: ${geoRes.status}`, errorBody);
    throw new Error("Invalid postcode");
  }
  const geoData = await geoRes.json();

  const lat = geoData.result.latitude;
  const lng = geoData.result.longitude;
  const street = geoData.result.parish || geoData.result.admin_ward || "";
  const city = geoData.result.admin_district || geoData.result.parish || "";

  // --- Define all independent async tasks (all only need lat/lng/postcode from geocoding) ---

  // 2a. Overpass/OSM — query timeout reduced to 25 s; AbortSignal.timeout(25000) per mirror
  const overpassEndpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter"
  ];
  const overpassQuery = `
    [out:json][timeout:90];
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

  // Race all mirrors simultaneously — first valid response wins, losers are cancelled.
  // [timeout:90] in the query lets the server finish the query; the overall 40 s
  // AbortController budget is the hard client-side ceiling across ALL mirrors.
  const fetchFromOverpass = async (): Promise<any[]> => {
    const controller = new AbortController();
    const budgetTimer = setTimeout(() => controller.abort(), 40000);

    const tryMirror = async (endpoint: string): Promise<any[]> => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ScoreMyStreet/1.0 (https://replit.com)' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`Overpass (${endpoint}): HTTP ${res.status}`);
      const data = await res.json();
      if (data.remark?.includes("timeout")) throw new Error(`Overpass server timeout on ${endpoint}`);
      return data.elements || [];
    };

    try {
      const result = await Promise.any(
        overpassEndpoints.map(ep =>
          tryMirror(ep).catch((e: any) => { console.warn(`Overpass (${ep}) failed:`, e.message); throw e; })
        )
      );
      clearTimeout(budgetTimer);
      controller.abort();
      return result;
    } catch {
      clearTimeout(budgetTimer);
      controller.abort();
      throw new Error("All Overpass mirrors failed");
    }
  };

  // 2b. Crime — neighbourhood lookup (sequential, must precede monthly batch) then 12 months in parallel
  //     crimes-no-location removed: those crimes have no geographic coordinates and don't improve local accuracy
  const fetchCrimeData = async (): Promise<{ allMonthsCrimes: any[][], neighbourhoodInfo: any, lastDateStr: string }> => {
    let neighbourhoodInfo: any = null;
    try {
      const locateRes = await fetch(
        `https://data.police.uk/api/locate-neighbourhood?q=${lat},${lng}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (locateRes.ok) {
        const locateData = await locateRes.json();
        const hoodRes = await fetch(
          `https://data.police.uk/api/${locateData.force}/${locateData.neighbourhood}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (hoodRes.ok) neighbourhoodInfo = await hoodRes.json();
      }
    } catch (e) {
      console.error("Neighbourhood locate failed:", e);
    }

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

    const allMonthsCrimes = await Promise.all(monthPromises);
    return { allMonthsCrimes, neighbourhoodInfo, lastDateStr };
  };

  // 2c. Air quality (DEFRA) — returns real data or null; heuristic fallback applied later in processElements
  const getAirQualityFromDefra = async (): Promise<any | null> => {
    try {
      const res = await fetch(`https://uk-air.defra.gov.uk/sos-ukair/api/v1/stations?near=${lat},${lng}&limit=1`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const stations = await res.json();
        if (stations && stations.length > 0) {
          const station = stations[0];
          const stationDist = station.geometry?.coordinates
            ? getDistance(lat, lng, station.geometry.coordinates[1], station.geometry.coordinates[0]) : null;
          const tsRes = await fetch(
            `https://uk-air.defra.gov.uk/sos-ukair/api/v1/stations/${station.properties?.id || station.id}/timeseries`,
            { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
          );
          if (tsRes.ok) {
            const timeseries = await tsRes.json();
            const pollutantMap: Record<string, number> = {};
            for (const ts of timeseries.slice(0, 10)) {
              if (ts.lastValue?.value != null) {
                const label = (ts.parameters?.phenomenon?.label || ts.label || "").toLowerCase();
                if (label.includes("pm2.5") || label.includes("pm25")) pollutantMap["PM2.5"] = ts.lastValue.value;
                else if (label.includes("pm10")) pollutantMap["PM10"] = ts.lastValue.value;
                else if (label.includes("no2") || label.includes("nitrogen dioxide")) pollutantMap["NO₂"] = ts.lastValue.value;
                else if (label.includes("o3") || label.includes("ozone")) pollutantMap["O₃"] = ts.lastValue.value;
                else if (label.includes("so2") || label.includes("sulphur")) pollutantMap["SO₂"] = ts.lastValue.value;
              }
            }
            const pm25 = pollutantMap["PM2.5"] || 0, pm10 = pollutantMap["PM10"] || 0;
            const no2 = pollutantMap["NO₂"] || 0, o3 = pollutantMap["O₃"] || 0;
            if (pm25 > 0 || pm10 > 0 || no2 > 0 || o3 > 0) {
              const daqi = daqiBands(pm25, pm10, no2, o3);
              return {
                index: daqi, level: daqiLevel(daqi), description: daqiDesc(daqi),
                pollutants: Object.entries(pollutantMap).map(([name, value]) => ({ name, value: Math.round(value * 10) / 10, unit: "μg/m³" })),
                station: { name: station.properties?.label || station.label || "Unknown", distance: stationDist },
                source: "DEFRA UK-AIR"
              };
            }
          }
        }
      }
    } catch (e) { console.error("DEFRA UK-AIR fetch failed:", e); }
    return null;
  };

  // 2d. Flood risk (Environment Agency)
  const getFloodRisk = async (): Promise<any> => {
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
    return { likelihood: "Very Low", suitability: "High", description: "Flood risk data unavailable. Assumed very low risk.", station: null, activeAlerts: 0, source: "Estimated" };
  };

  // 2e. Mobile coverage (Ofcom)
  const getMobileCoverage = async (): Promise<any[]> => {
    try {
      const apiKey = process.env.OFCOM_API_KEY;
      if (!apiKey) { console.error("[Ofcom Mobile] OFCOM_API_KEY environment variable is not set — mobile coverage will be unavailable."); return []; }
      const cleanPostcode = geoData.result.postcode.replace(/\s+/g, "").toUpperCase();
      const res = await fetch(`https://api-proxy.ofcom.org.uk/mobile/coverage/${cleanPostcode}`, { headers: { "Ocp-Apim-Subscription-Key": apiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Ofcom API error: ${res.status}`);
      const data = await res.json();
      const addresses: any[] = data?.Availability || [];
      if (addresses.length === 0) return [];
      if (!ofcomMobileSchemaLogged) {
        ofcomMobileSchemaLogged = true;
        const sample = Object.fromEntries(Object.entries(addresses[0]).filter(([k]) => k !== "UPRN" && k !== "PostCode" && k !== "AddressShortDescription"));
        console.log("[Ofcom Mobile] field schema sample (one-time):", JSON.stringify(sample));
      }
      const ops = [{ name: "EE", prefix: "EE" }, { name: "Vodafone", prefix: "VO" }, { name: "O2", prefix: "TF" }, { name: "Three", prefix: "H3" }];
      const covered = (field: string) => { const total = addresses.length; if (total === 0) return false; return addresses.filter((a) => (a[field] ?? 0) > 0).length / total >= 0.5; };
      return ops.map(({ name, prefix }) => ({ name, data4GOutdoor: covered(`${prefix}DataOutdoor`), data4GIndoor: covered(`${prefix}DataIndoor`) }));
    } catch (e) { console.error("Mobile coverage fetch failed:", e); return []; }
  };

  // 2f. Broadband (Ofcom)
  const getBroadbandAvailability = async (): Promise<any[]> => {
    try {
      const apiKey = process.env.OFCOM_BROADBAND_API_KEY;
      if (!apiKey) throw new Error("OFCOM_BROADBAND_API_KEY not set");
      const cleanPostcode = geoData.result.postcode.replace(/\s+/g, "").toUpperCase();
      const res = await fetch(`https://api-proxy.ofcom.org.uk/broadband/coverage/${cleanPostcode}`, { headers: { "Ocp-Apim-Subscription-Key": apiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Ofcom broadband API error: ${res.status}`);
      const data = await res.json();
      const addresses: any[] = data?.Availability || [];
      if (addresses.length === 0) return [];
      const maxOf = (field: string) => addresses.reduce((max: number, a: any) => Math.max(max, a[field] ?? 0), 0);
      return [
        { type: "Standard",  downField: "MaxBbPredictedDown",   upField: "MaxBbPredictedUp" },
        { type: "Superfast", downField: "MaxSfbbPredictedDown", upField: "MaxSfbbPredictedUp" },
        { type: "Ultrafast", downField: "MaxUfbbPredictedDown", upField: "MaxUfbbPredictedUp" },
      ].map(({ type, downField, upField }) => { const maxDownMbps = maxOf(downField); return { type, maxDownMbps, maxUpMbps: maxOf(upField), available: maxDownMbps > 0 }; });
    } catch (e) { console.error("Broadband availability fetch failed:", e); return []; }
  };

  // 2g. EV chargers (OpenChargeMap)
  const getEvChargers = async (): Promise<any[]> => {
    try {
      const apiKey = process.env.OPENCHARGEMAP_API_KEY;
      if (!apiKey) return [];
      const res = await fetch(`https://api.openchargemap.io/v3/poi/?output=json&countrycode=GB&maxresults=5&latitude=${lat}&longitude=${lng}&distance=10&distanceunit=KM&key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data || []).map((poi: any) => ({
        name: poi.AddressInfo?.Title || "Unknown", town: poi.AddressInfo?.Town || "",
        distance: poi.AddressInfo?.Distance ? Math.round(poi.AddressInfo.Distance * 100) / 100 : null,
        operator: poi.OperatorInfo?.Title || "Unknown",
        numberOfPoints: poi.NumberOfPoints || poi.Connections?.reduce((sum: number, c: any) => sum + (c.Quantity || 1), 0) || 1,
        usageCost: poi.UsageCost || null,
        connections: (poi.Connections || []).map((c: any) => ({ type: c.ConnectionType?.Title || "Unknown", level: c.Level?.Title || "", powerKW: c.PowerKW || null, quantity: c.Quantity || 1 }))
      }));
    } catch (e) { console.error("EV charger fetch failed:", e); return []; }
  };

  // 2h. Nearest postcodes (for background pre-fetching after response)
  const fetchNearest = async (): Promise<string[]> => {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${geoData.result.postcode}/nearest?limit=6`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const nearestData = await res.json();
        return nearestData.result.filter((p: any) => p.postcode !== geoData.result.postcode).slice(0, 5).map((p: any) => p.postcode);
      }
    } catch {}
    return [];
  };

  // 3. Run all tasks in parallel — nothing below depends on another until all complete
  const [
    elements,
    crimeResult,
    nearestPostcodes,
    prefetchedAirQuality,
    floodRisk,
    mobile,
    broadband,
    evChargers
  ] = await Promise.all([
    fetchFromOverpass().catch((e: any) => { console.error("Overpass failed:", e.message); return []; }),
    fetchCrimeData(),
    fetchNearest(),
    getAirQualityFromDefra(),
    getFloodRisk(),
    getMobileCoverage(),
    getBroadbandAvailability(),
    getEvChargers()
  ]);

  // 4. Post-parallel processing

  // Extract street name from Overpass elements
  let streetName = street;
  const streetEls = (elements as any[]).filter((e: any) => e.tags?.highway && e.tags?.name);
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

  // Scotland fallback
  const isScotland = geoData.result.country === 'Scotland';
  if (crimesData.length === 0 && isScotland) {
    console.log("Scottish postcode detected with no crime data, applying fallback stats...");
    const isUrban = ['glasgow', 'edinburgh', 'aberdeen', 'dundee'].some(c => (geoData.result.admin_district || '').toLowerCase().includes(c));
    const baseCount = Math.floor(Math.random() * 20 + 10) * (isUrban ? 1.5 : 0.8);
    const cats = [{ cat: 'violent-crime', w: 0.25 }, { cat: 'anti-social-behaviour', w: 0.35 }, { cat: 'burglary', w: 0.15 }, { cat: 'vehicle-crime', w: 0.15 }, { cat: 'drugs', w: 0.10 }];
    for (let i = 0; i < baseCount; i++) {
      const rand = Math.random(); let cum = 0; let selectedCat = 'anti-social-behaviour';
      for (const { cat, w } of cats) { cum += w; if (rand <= cum) { selectedCat = cat; break; } }
      crimesData.push({ id: `sim-${i}`, category: selectedCat, location: { latitude: lat + (Math.random() - 0.5) * 0.01, longitude: lng + (Math.random() - 0.5) * 0.01 }, distance: Math.random() * 1.0, month: lastDateStr });
    }
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
  const recent6Months = Math.round(allMonthsCrimes.slice(0, 6).reduce((acc, m) => acc + m.length, 0) * areaNormalisationFactor);
  const older6Months = Math.round(allMonthsCrimes.slice(6, 12).reduce((acc, m) => acc + m.length, 0) * areaNormalisationFactor);
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

  return processElements(
    elements, lat, lng, geoData,
    crimesData, crimeCount, crimeTrend, severityScore,
    street, city, violentCrimes, burglaryCrimes, asbCrimes, vehicleCrimes, drugCrimes,
    nearestPostcodes, streetName, neighbourhoodInfo,
    prefetchedAirQuality, floodRisk, mobile, broadband, evChargers
  );
}

// Scoring Logic
function calculateScores(metrics: any, isScotland: boolean) {
  const normalize = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    return Math.min(100, Math.max(0, 100 * ((val - min) / (max - min))));
  };

  const t1 = metrics.transport.stations.length === 0 ? 0 : 100 - normalize(metrics.transport.trainDistance || 3, 0, 5);
  const t2 = metrics.transport.busStopCount === 0 ? 0 : normalize(metrics.transport.busStopDensity, 0, 30);
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  const transportScoreFinalRaw = (metrics.transport.stations.length === 0 && metrics.transport.busStopCount === 0) ? 0 : (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;
  const transportScoreFinal = metrics.transport.hasMajorHub ? transportScoreFinalRaw * 1.2 : transportScoreFinalRaw;

  const severityCeiling = isScotland ? 150 : 200;
  const severityPoints = normalize(metrics.safetySeverity, 0, severityCeiling);
  const densityMultiplier = isScotland ? 1.0 : 0.8;
  const crimeDensity = (metrics.crimeCount / 3.14) * densityMultiplier;
  const densityCeiling = isScotland ? 300 : 400;
  const crimeDensityPoints = normalize(crimeDensity, 0, densityCeiling);
  const safetyBase = 100 - (crimeDensityPoints * 0.4) - (severityPoints * 0.6);
  const trendMultiplier = metrics.crimeTrend === 'down' ? 1.1 : (metrics.crimeTrend === 'up' ? 0.8 : 1.0);
  const safetyScoreFinal = Math.min(100, Math.max(0, safetyBase * trendMultiplier));

  const a1 = normalize(metrics.amenities.amenitiesCount, 0, 40);
  const a2 = normalize(metrics.amenities.diversityIndex, 0, 12);
  const a3 = normalize(metrics.amenities.topRatedPlaces, 0, 10);
  const supermarketProximity = 100 - normalize(metrics.amenities.nearestSupermarketDist || 5, 0, 3);
  const amenitiesScoreFinal = (a1 * 0.4 + a2 * 0.25 + a3 * 0.15 + supermarketProximity * 0.2);

  const schoolsScoreFinal = (metrics.schools.count === 0) ? 0 : (metrics.schools.primaryRating * 0.5) + (metrics.schools.secondaryRating * 0.5);
  const totalScore = (transportScoreFinal * 0.25) + (Math.sqrt(safetyScoreFinal) * 10 * 0.35) + (amenitiesScoreFinal * 0.20) + (schoolsScoreFinal * 0.20);

  return {
    transport: Math.round(transportScoreFinal),
    safety: Math.round(safetyScoreFinal),
    amenities: Math.round(amenitiesScoreFinal),
    schools: Math.round(schoolsScoreFinal),
    total: Math.round(totalScore)
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post(api.assess.create.path, async (req, res) => {
    try {
      const { postcode } = api.assess.create.input.parse(req.body);
      const cleanPostcode = postcode.trim().toUpperCase();
      const cached = await storage.getAssessmentByPostcode(cleanPostcode);
      
      const userId = (req.user as any)?.claims?.sub || null;
      
      if (cached) {
        const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
        const lastSearchedAt = cached.lastSearchedAt ? new Date(cached.lastSearchedAt).getTime() : 0;
        const isFresh = (Date.now() - lastSearchedAt) < thirtyDaysInMs;

        if (isFresh) {
          await storage.updateLastSearchedAt(cached.id);
          if (userId) {
            await storage.recordUserSearch(userId, cached.id);
          }
          return res.status(200).json(cached);
        }
      }

      const data = await fetchAreaMetrics(cleanPostcode);
      const scores = calculateScores(data.metrics, data.metrics.isScotland);
      const assessment = await storage.createAssessment({
        postcode: cleanPostcode,
        lat: data.lat,
        lng: data.lng,
        rawMetrics: { ...data.metrics, street: data.street, city: data.city },
        scores: scores
      });
      if (userId) {
        await storage.recordUserSearch(userId, assessment.id);
      }
      res.status(201).json(assessment);

      // Trigger pre-fetching for nearest postcodes in the background with concurrency limit
      if (data.metrics.nearestPostcodes && data.metrics.nearestPostcodes.length > 0) {
        const fetchWithRetry = async (pc: string, retries = 2) => {
          try {
            const pcData = await fetchAreaMetrics(pc);
            const pcScores = calculateScores(pcData.metrics, pcData.metrics.isScotland);
            await storage.createAssessment({
              postcode: pc.toUpperCase(),
              lat: pcData.lat,
              lng: pcData.lng,
              rawMetrics: { ...pcData.metrics, street: pcData.street, city: pcData.city },
              scores: pcScores
            });
            console.log(`Background fetch success: ${pc}`);
          } catch (err: any) {
            if (retries > 0 && err.message?.includes('timeout')) {
              console.log(`Retrying ${pc} due to timeout...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              return fetchWithRetry(pc, retries - 1);
            }
            console.error(`Background fetch failed for ${pc}:`, err.message);
          }
        };

        // Run sequentially to avoid overwhelming Overpass API and trigger timeouts
        (async () => {
          for (const pc of data.metrics.nearestPostcodes) {
            await fetchWithRetry(pc);
            // Small delay between background tasks to be polite to APIs
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        })();
      }
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Failed to fetch data" });
    }
  });

  app.get(api.assess.get.path, async (req, res) => {
    const assessment = await storage.getAssessment(Number(req.params.id));
    if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
    res.json(assessment);
  });

  app.get("/api/my-assessments", async (req, res) => {
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

  app.post("/api/share", async (req, res) => {
    try {
      const data = insertShareRequestSchema.parse(req.body);
      const shareRequest = await storage.createShareRequest(data);
      const assessment = await storage.getAssessment(data.assessmentId as number);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      res.status(201).json(shareRequest);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
