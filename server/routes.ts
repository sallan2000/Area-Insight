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
      node["amenity"~"cafe|restaurant|pub|bar|library|pharmacy|marketplace|post_office"](around:1609,${lat},${lng});
      node["amenity"~"school|college|university"](around:1609,${lat},${lng});
      node["highway"="bus_stop"](around:1000,${lat},${lng});
      node["railway"="station"](around:1000,${lat},${lng});
    );
    out body;
  `;
  
  const osmRes = await fetch(overpassUrl, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`
  });
  
  const osmData = osmRes.ok ? await osmRes.json() : { elements: [] };
  const elements = osmData.elements;

  // Deduplicate and filter elements
  const localAmenitiesElements = elements.filter((e: any) => e.tags?.amenity && !["school", "college", "university", "bus_stop", "pharmacy", "post_office"].includes(e.tags.amenity));
  const essentialAmenitiesElements = elements.filter((e: any) => ["pharmacy", "post_office"].includes(e.tags?.amenity));
  
  const busStopList = Array.from(new Set(elements.filter((e: any) => e.tags?.highway === "bus_stop").map((e: any) => e.tags.name || "Unnamed Bus Stop")));
  const trainStationList = Array.from(new Set(elements.filter((e: any) => e.tags?.railway === "station").map((e: any) => e.tags.name || "Unnamed Station")));
  const schoolList = Array.from(new Set(elements.filter((e: any) => e.tags?.amenity === "school" || e.tags?.amenity === "college" || e.tags?.amenity === "university").map((e: any) => e.tags.name || "Unnamed Educational Facility")));
  
  const amenitiesList = [
    ...localAmenitiesElements.map((e: any) => ({ name: e.tags.name || "Local Amenity", category: e.tags.amenity })),
    ...essentialAmenitiesElements.map((e: any) => ({ name: e.tags.name || "Essential Service", category: e.tags.amenity }))
  ];

  const busStops = busStopList.length;
  const trainStations = trainStationList.length;
  const schoolsCount = schoolList.length;
  
  const categories = new Set(amenitiesList.map((e: any) => e.category));
  
  // Distances and Densities
  const trainDistance = trainStations > 0 ? 0.5 : 3.0; 
  const busStopDensity = busStops / 0.38; // Normalized to ~1km2 (0.38 sq miles)
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
      trainDistance,
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
  const t1 = 100 - normalize(metrics.transport.trainDistance, 0, 5);
  const t2 = normalize(metrics.transport.busStopDensity, 0, 30);
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  
  const transportScoreFinal = (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;

  // 2.3 Safety Score (Bespoke)
  // Severity normalized (10 weighted severe crimes = 50 reduction, scale is more sensitive)
  const severityReduction = normalize(metrics.safetySeverity, 0, 50);
  
  // Crime Density: Crimes per sq mile (1 mile radius ~3.14 sq miles)
  const crimeDensity = metrics.crimeCount / 3.14; 
  const crimeDensityReduction = normalize(crimeDensity, 0, 100); 
  
  // Base Safety starts at 100
  let safetyBase = 100 - (crimeDensityReduction * 0.4) - (severityReduction * 0.6);
  
  // Clamping and applying trend
  const trendMultiplier = metrics.crimeTrend === 'down' ? 1.05 : (metrics.crimeTrend === 'up' ? 0.9 : 1.0);
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
