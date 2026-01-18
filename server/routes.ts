import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

// Helper function to fetch external data
async function fetchAreaMetrics(postcode: string) {
  // 1. Geocode Postcode
  const geoRes = await fetch(`https://api.postcodes.io/postcodes/${postcode}`);
  if (!geoRes.ok) throw new Error("Invalid postcode");
  const geoData = await geoRes.json();
  
  const lat = geoData.result.latitude;
  const lng = geoData.result.longitude;
  const street = geoData.result.parish || geoData.result.admin_ward || "";
  const city = geoData.result.admin_district || geoData.result.parish || "";

  // 2. Fetch Crime Data (Real-time from UK Police API)
  const crimeRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`);
  const crimesData = crimeRes.ok ? await crimeRes.json() : [];
  const crimeCount = crimesData.length;
  
  // Real crime trend (last month vs month before)
  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthBefore = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthBeforeStr = `${monthBefore.getFullYear()}-${String(monthBefore.getMonth() + 1).padStart(2, '0')}`;

  const crimeHistRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${monthBeforeStr}`);
  const histCrimes = crimeHistRes.ok ? await crimeHistRes.json() : [];
  const crimeTrend = crimesData.length < histCrimes.length ? "down" : (crimesData.length > histCrimes.length ? "up" : "stable");

  // 3. Amenities & Schools from OpenStreetMap (Overpass API)
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"cafe|restaurant|pub|bar|library|pharmacy|marketplace|post_office"](around:2500,${lat},${lng});
      node["amenity"~"school|college|university"](around:5000,${lat},${lng});
      node["highway"="bus_stop"](around:2000,${lat},${lng});
      node["railway"="station"](around:5000,${lat},${lng});
    );
    out body center;
  `;
  
  const osmRes = await fetch(overpassUrl, {
    method: "POST",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ScoreMyStreet/1.0 (https://replit.com)'
    },
    body: `data=${encodeURIComponent(query)}`
  });
  
  if (!osmRes.ok) {
    const errorText = await osmRes.text();
    console.error(`Overpass API Error: ${osmRes.status} ${osmRes.statusText}`, errorText);
  }
  
  const osmData = osmRes.ok ? await osmRes.json() : { elements: [] };
  const elements = osmData.elements || [];

  // Helper function to calculate distance between two points in km
  function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

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
        unique.set(name, item);
      }
      if (unique.size >= limit) break;
    }
    return Array.from(unique.values()).map(item => ({
      name: item.tags.name || "Unnamed",
      distance: Math.round(item.distance * 10) / 10
    }));
  };

  const busStopList = getNearest(elementsWithDistance.filter((e: any) => e.tags?.highway === "bus_stop"), 5);
  const trainStationList = getNearest(elementsWithDistance.filter((e: any) => e.tags?.railway === "station"), 5);
  const schoolList = getNearest(elementsWithDistance.filter((e: any) => e.tags?.amenity === "school" || e.tags?.amenity === "college" || e.tags?.amenity === "university"), 5);
  
  const amenitiesList = [
    ...localAmenitiesElements.map((e: any) => ({ name: e.tags.name || "Local Amenity", category: e.tags.amenity, distance: Math.round(e.distance * 10) / 10 })),
    ...essentialAmenitiesElements.map((e: any) => ({ name: e.tags.name || "Essential Service", category: e.tags.amenity, distance: Math.round(e.distance * 10) / 10 }))
  ].sort((a, b) => a.distance - b.distance);

  const busStops = busStopList.length;
  const trainStations = trainStationList.length;
  const schoolsCount = schoolList.length;
  
  const categories = new Set(amenitiesList.map((e: any) => e.category));
  
  // Distances and Densities
  const minTrainDist = trainStationList.length > 0 ? trainStationList[0].distance : 3.0;
  const busStopDensity = busStops / 0.38; 
  const diversityIndex = categories.size;
  const amenitiesCount = amenitiesList.length; 

  // 4. TfL Integration (if London-based)
  let tflData = null;
  if (geoData.result.region === "London") {
    const tflRes = await fetch(`https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=1609`);
    tflData = tflRes.ok ? await tflRes.json() : null;
  }

  // Calculate commute (simplified fallback)
  const commuteCityCenter = tflData ? 25 : 45; 
  const commuteMajorHub = tflData ? 15 : 30;

  // 5. Bespoke Safety Analysis
  const violentCrimes = crimesData.filter((c: any) => c.category === 'violent-crime' || c.category === 'robbery').length;
  const burglaryCrimes = crimesData.filter((c: any) => c.category === 'burglary' || c.category === 'theft-from-the-person').length;
  const asbCrimes = crimesData.filter((c: any) => c.category === 'anti-social-behaviour').length;
  
  // Severity Index: Weighted severe crimes vs total
  const severityScore = (violentCrimes * 5) + (burglaryCrimes * 3) + (asbCrimes * 1);

  const resultMetrics = {
    crimeCount,
    crimeTrend,
    safetySeverity: severityScore,
    transport: {
      trainDistance: minTrainDist,
      busStopDensity,
      busStopCount: busStops,
      stationCount: trainStations,
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
      count: schoolsCount,
      list: schoolList
    }
  };

  return {
    lat: String(lat),
    lng: String(lng),
    street,
    city,
    metrics: resultMetrics
  };
}

// Scoring Logic
function calculateScores(metrics: any) {
  const normalize = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    const score = 100 * ((val - min) / (max - min));
    return Math.min(100, Math.max(0, score));
  };

  // 2.2 Transport Score
  const t1 = 100 - normalize(metrics.transport.trainDistance || 3, 0, 5);
  const t2 = normalize(metrics.transport.busStopDensity, 0, 30);
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  
  const transportScoreFinal = (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;

  // 2.3 Safety Score (Bespoke)
  // Base Safety starts at 100
  // More aggressive reduction to see variation
  const severityPoints = normalize(metrics.safetySeverity, 0, 30); // Lowered max for more sensitivity
  const crimeDensity = metrics.crimeCount / 3.14; 
  const crimeDensityPoints = normalize(crimeDensity, 0, 50); // Lowered max for more sensitivity
  
  let safetyBase = 100 - (crimeDensityPoints * 0.5) - (severityPoints * 0.7);
  
  // Clamping and applying trend
  const trendMultiplier = metrics.crimeTrend === 'down' ? 1.1 : (metrics.crimeTrend === 'up' ? 0.8 : 1.0);
  const safetyScoreFinal = Math.min(100, Math.max(0, safetyBase * trendMultiplier));

  // 2.4 Amenities Score
  const a1 = normalize(metrics.amenities.amenitiesCount, 0, 40);
  const a2 = normalize(metrics.amenities.diversityIndex, 0, 10);
  const a3 = normalize(metrics.amenities.topRatedPlaces, 0, 10);
  const amenitiesScoreFinal = (a1 * 0.5 + a2 * 0.3 + a3 * 0.2);

  // 2.5 Schools Score
  const schoolsScoreFinal = (metrics.schools.primaryRating * 0.5) + (metrics.schools.secondaryRating * 0.5);

  // 2.6 Liveability Score
  const totalScore = (transportScoreFinal * 0.25) + (safetyScoreFinal * 0.25) + (amenitiesScoreFinal * 0.25) + (schoolsScoreFinal * 0.25);

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
      
      try {
        // Fetch and Calculate
        const data = await fetchAreaMetrics(postcode);
        const scores = calculateScores(data.metrics);
        
        // Store
        const assessment = await storage.createAssessment({
          postcode,
          lat: data.lat,
          lng: data.lng,
          rawMetrics: { ...data.metrics, street: data.street, city: data.city },
          scores: scores
        });

        res.status(201).json(assessment);
      } catch (e: any) {
        res.status(400).json({ message: e.message || "Failed to fetch data for this postcode" });
      }

    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.assess.get.path, async (req, res) => {
    const assessment = await storage.getAssessment(Number(req.params.id));
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    res.json(assessment);
  });

  return httpServer;
}
