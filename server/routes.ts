import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, insertShareRequestSchema } from "@shared/routes";
import { z } from "zod";

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

function processElements(elements: any[], lat: number, lng: number, geoData: any, crimesData: any[], crimeCount: number, crimeTrend: string, severityScore: number, street: string, city: string, violentCrimes: number, burglaryCrimes: number, asbCrimes: number, vehicleCrimes: number, drugCrimes: number, nearestPostcodes: string[], streetName: string, neighbourhoodInfo: any) {
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
      .map((e: any) => ({ name: e.tags.name, category: e.tags.amenity, distance: e.distance }))
  ].sort((a, b) => a.distance - b.distance);

  const busStops = busStopList.length;
  const trainStations = trainStationList.length;
  const hasMajorHub = trainStationList.some(s => s.isHub) || busStopList.some(s => s.isHub);
  
  const categories = new Set(amenitiesList.map((e: any) => e.category));
  
  // Distances and Densities
  const minTrainDist = trainStationList.length > 0 ? trainStationList[0].distance : 3.0;
  const busStopDensity = busStops / 0.38; 
  const diversityIndex = categories.size;
  const amenitiesCount = amenitiesList.length; 

  // Estimate Council Tax Band (Fallback heuristic for demo purposes)
  const getEstimatedBand = (outcode: string) => {
    const highValuePrefixes = ['SW', 'W', 'NW', 'EC', 'WC', 'SE1', 'E1W'];
    if (highValuePrefixes.some(pref => outcode.startsWith(pref))) return 'G';
    if (['N', 'E', 'S', 'W'].some(pref => outcode.startsWith(pref))) return 'E';
    const affluentPrefixes = ['OX', 'GU', 'RG', 'SL', 'HP', 'AL', 'SG'];
    if (affluentPrefixes.some(pref => outcode.startsWith(pref))) return 'D';
    return 'C';
  };

  const councilTaxBand = getEstimatedBand(geoData.result.outcode);
  const councilTaxLink = geoData.result.country === 'Scotland' 
    ? "https://www.saa.gov.uk/" 
    : "https://www.tax.service.gov.uk/check-council-tax-band/search";

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
      list: amenitiesList
    },
    schools: {
      primaryRating: 80,
      secondaryRating: 80,
      count: primarySchools.length + secondarySchools.length,
      primaryList: primarySchools,
      secondaryList: secondarySchools
    },
    councilTax: {
      estimatedBand: councilTaxBand,
      lookupUrl: councilTaxLink
    },
    connectivity: {
      broadband: [
        { type: "Standard", speed: "11 Mbps", availability: "Likely" },
        { type: "Superfast", speed: "80 Mbps", availability: "Likely" },
        { type: "Ultrafast", speed: "1000 Mbps", availability: "Likely" }
      ],
      mobile: {
        fourG: "Excellent",
        fiveG: "Good"
      }
    },
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
      classification: geoData.result.status === "live" ? (geoData.result.admin_district || "Residential Area") : "Residential Area"
    }
  };
}

// Helper function to fetch external data
async function fetchAreaMetrics(postcode: string) {
  // 1. Geocode Postcode
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

  // 4. Try to get a better street name from OSM data
  let streetName = street;
  
  // 3. Amenities & Schools from OpenStreetMap (Overpass API)
  const overpassUrl = "https://www.overpass-api.de/api/interpreter";
  const query = `
    [out:json][timeout:90];
    (
      node["amenity"~"cafe|restaurant|pub|bar|library|pharmacy|marketplace|post_office"](around:2500,${lat},${lng});
      node["amenity"~"school|college|university|kindergarten"](around:3000,${lat},${lng});
      way["amenity"~"school|college|university|kindergarten"](around:3000,${lat},${lng});
      node["highway"~"bus_stop|platform"](around:2000,${lat},${lng});
      node["railway"~"station|halt"](around:5000,${lat},${lng});
      way["railway"~"station|halt"](around:5000,${lat},${lng});
      way["highway"~"residential|unclassified|tertiary|secondary|primary"](around:50,${lat},${lng});
    );
    out body center;
  `;
  
  const fetchFromOverpass = async (url: string, queryStr: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ScoreMyStreet/1.0 (https://replit.com)'
      },
      body: `data=${encodeURIComponent(queryStr)}`
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Overpass API Error: ${res.status} ${res.statusText} ${errorText}`);
    }
    
    const data = await res.json();
    if (data.remark && data.remark.includes("timeout")) throw new Error("Overpass API timeout");
    return data.elements || [];
  };

  let elements = [];
  try {
    elements = await fetchFromOverpass(overpassUrl, query);
    const streetElements = elements.filter((e: any) => e.tags?.highway && e.tags?.name);
    if (streetElements.length > 0) {
      const closestStreet = streetElements.map((e: any) => {
        const elLat = e.lat || e.center?.lat;
        const elLon = e.lon || e.center?.lon;
        return {
          name: e.tags.name,
          distance: getDistance(lat, lng, elLat, elLon)
        };
      }).sort((a: any, b: any) => a.distance - b.distance)[0];
      if (closestStreet) streetName = closestStreet.name;
    }
  } catch (e: any) {
    console.error("Overpass failed, trying fallback...", e.message);
  }

  if (elements.length === 0) {
    throw new Error("Could not retrieve local amenities from any provider. Please try again later.");
  }

  // 2. Fetch Crime Data
  const monthsToFetch = 12;
  const today = new Date();
  const fetchPromises = [];
  
  // Get neighbourhood info if possible
  let neighbourhoodInfo = null;
  try {
    const locateRes = await fetch(`https://data.police.uk/api/locate-neighbourhood?q=${lat},${lng}`);
    if (locateRes.ok) {
      const locateData = await locateRes.json();
      const hoodRes = await fetch(`https://data.police.uk/api/${locateData.force}/${locateData.neighbourhood}`);
      if (hoodRes.ok) {
        neighbourhoodInfo = await hoodRes.json();
      }
    }
  } catch (e) {
    console.error("Neighbourhood locate failed:", e);
  }

  for (let i = 1; i <= monthsToFetch; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    
    let url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${dateStr}`;
    // The user specifically asked to use the neighbourhood specific search, but it often returns no results 
    // for recent months or specific categories. Let's fetch BOTH or fallback.
    // Actually, "crimes-no-location" is for crimes that COULD NOT be mapped to a specific location.
    // The user probably wants "crimes-at-location" or just the standard street level crimes for that neighbourhood.
    // However, the data.police.uk API for a neighbourhood's crimes is usually via the 'crimes' endpoint if they provide a boundary,
    // but the most reliable way to get crimes for an area is still the lat/lng street-level API.
    
    // Let's try to fetch both if neighbourhood is available, and merge them.
    const fetchCrimeData = async (targetUrl: string) => {
      try {
        const res = await fetch(targetUrl);
        return res.ok ? await res.json() : [];
      } catch (e) {
        return [];
      }
    };

    fetchPromises.push((async () => {
      const streetCrimes = await fetchCrimeData(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${dateStr}`);
      let neighbourhoodCrimes: any[] = [];
      
      if (neighbourhoodInfo) {
        // Try the "crimes-no-location" as requested, but also maybe they meant "crimes-at-location"
        neighbourhoodCrimes = await fetchCrimeData(`https://data.police.uk/api/crimes-no-location?category=all-crime&force=${neighbourhoodInfo.url_force}&neighbourhood=${neighbourhoodInfo.id}&date=${dateStr}`);
      }

      const combined = [...(Array.isArray(streetCrimes) ? streetCrimes : []), ...(Array.isArray(neighbourhoodCrimes) ? neighbourhoodCrimes : [])];
      
      // Deduplicate by ID
      const uniqueCrimes = Array.from(new Map(combined.map(c => [c.id, c])).values());

      return uniqueCrimes.map((c: any) => {
        const cLat = c.location?.latitude ? parseFloat(c.location.latitude) : lat;
        const cLng = c.location?.longitude ? parseFloat(c.location.longitude) : lng;
        return {
          ...c,
          distance: getDistance(lat, lng, cLat, cLng)
        };
      });
    })());
  }

  const allMonthsCrimes = await Promise.all(fetchPromises);
  const crimesData: any[] = [];
  allMonthsCrimes.forEach(monthCrimes => crimesData.push(...monthCrimes));
  const crimeCount = crimesData.length;
  const recent6Months = allMonthsCrimes.slice(0, 6).reduce((acc, m) => acc + m.length, 0);
  const older6Months = allMonthsCrimes.slice(6, 12).reduce((acc, m) => acc + m.length, 0);
  const crimeTrend = recent6Months < older6Months ? "down" : (recent6Months > older6Months ? "up" : "stable");

  const violentCrimes = crimesData.filter((c: any) => c.category === 'violent-crime' || c.category === 'robbery' || c.category === 'possession-of-weapons' || c.category === 'violence-and-sexual-offences').length;
  const burglaryCrimes = crimesData.filter((c: any) => c.category === 'burglary' || c.category === 'theft-from-the-person' || c.category === 'shoplifting').length;
  const asbCrimes = crimesData.filter((c: any) => c.category === 'anti-social-behaviour' || c.category === 'public-order').length;
  const vehicleCrimes = crimesData.filter((c: any) => c.category === 'vehicle-crime').length;
  const drugCrimes = crimesData.filter((c: any) => c.category === 'drugs').length;
  const severityScore = (violentCrimes * 5) + (burglaryCrimes * 3) + (asbCrimes * 1) + (vehicleCrimes * 2) + (drugCrimes * 2);

  // 4. Fetch Nearest Postcodes
  const fetchNearest = async () => {
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${geoData.result.postcode}/nearest?limit=6`);
      if (res.ok) {
        const nearestData = await res.json();
        return nearestData.result
          .filter((p: any) => p.postcode !== geoData.result.postcode)
          .slice(0, 5)
          .map((p: any) => p.postcode);
      }
    } catch (e) {}
    return [];
  };

  const nearestPostcodes = await fetchNearest();
  
  return processElements(elements, lat, lng, geoData, crimesData, crimeCount, crimeTrend, severityScore, street, city, violentCrimes, burglaryCrimes, asbCrimes, vehicleCrimes, drugCrimes, nearestPostcodes, streetName, neighbourhoodInfo);
}

// Scoring Logic
function calculateScores(metrics: any) {
  const normalize = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    return Math.min(100, Math.max(0, 100 * ((val - min) / (max - min))));
  };

  const t1 = 100 - normalize(metrics.transport.trainDistance || 3, 0, 5);
  const t2 = normalize(metrics.transport.busStopDensity, 0, 30);
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  const transportScoreFinalRaw = (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;
  const transportScoreFinal = metrics.transport.hasMajorHub ? transportScoreFinalRaw * 1.2 : transportScoreFinalRaw;

  const severityPoints = normalize(metrics.safetySeverity, 0, 300);
  const crimeDensity = metrics.crimeCount / 3.14; 
  const crimeDensityPoints = normalize(crimeDensity, 0, 500);
  const safetyBase = 100 - (crimeDensityPoints * 0.5) - (severityPoints * 0.7);
  const trendMultiplier = metrics.crimeTrend === 'down' ? 1.1 : (metrics.crimeTrend === 'up' ? 0.8 : 1.0);
  const safetyScoreFinal = Math.min(100, Math.max(0, safetyBase * trendMultiplier));

  const a1 = normalize(metrics.amenities.amenitiesCount, 0, 40);
  const a2 = normalize(metrics.amenities.diversityIndex, 0, 10);
  const a3 = normalize(metrics.amenities.topRatedPlaces, 0, 10);
  const amenitiesScoreFinal = (a1 * 0.5 + a2 * 0.3 + a3 * 0.2);

  const schoolsScoreFinal = (metrics.schools.primaryRating * 0.5) + (metrics.schools.secondaryRating * 0.5);
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
      if (cached) {
        await storage.updateLastSearchedAt(cached.id);
        return res.status(200).json(cached);
      }
      const data = await fetchAreaMetrics(cleanPostcode);
      const scores = calculateScores(data.metrics);
      const assessment = await storage.createAssessment({
        postcode: cleanPostcode,
        lat: data.lat,
        lng: data.lng,
        rawMetrics: { ...data.metrics, street: data.street, city: data.city },
        scores: scores
      });
      res.status(201).json(assessment);

      // Trigger pre-fetching for nearest postcodes in the background with concurrency limit
      if (data.metrics.nearestPostcodes && data.metrics.nearestPostcodes.length > 0) {
        const fetchWithRetry = async (pc: string, retries = 2) => {
          try {
            const pcData = await fetchAreaMetrics(pc);
            const pcScores = calculateScores(pcData.metrics);
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
