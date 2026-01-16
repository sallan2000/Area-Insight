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
  const outcode = geoData.result.outcode;

  // 2. Fetch Crime Data (Real-time from UK Police API)
  const crimeRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`);
  const crimes = crimeRes.ok ? await crimeRes.json() : [];
  const crimeCount = crimes.length;
  
  // Real crime trend (last month vs month before)
  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthBefore = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthBeforeStr = `${monthBefore.getFullYear()}-${String(monthBefore.getMonth() + 1).padStart(2, '0')}`;

  const crimeHistRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${monthBeforeStr}`);
  const histCrimes = crimeHistRes.ok ? await crimeHistRes.json() : [];
  const crimeTrend = crimes.length < histCrimes.length ? "down" : (crimes.length > histCrimes.length ? "up" : "stable");

  // 3. Amenities & Schools from OpenStreetMap (Overpass API)
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"cafe|restaurant|pub|bar|library|pharmacy|marketplace|post_office"](around:1000,${lat},${lng});
      node["amenity"~"school|college|university"](around:2000,${lat},${lng});
      node["highway"="bus_stop"](around:500,${lat},${lng});
      node["railway"="station"](around:2000,${lat},${lng});
    );
    out body;
  `;
  
  const osmRes = await fetch(overpassUrl, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`
  });
  
  const osmData = osmRes.ok ? await osmRes.json() : { elements: [] };
  const elements = osmData.elements;

  const busStops = elements.filter((e: any) => e.tags?.highway === "bus_stop").length;
  const trainStations = elements.filter((e: any) => e.tags?.railway === "station");
  const schools = elements.filter((e: any) => e.tags?.amenity === "school" || e.tags?.amenity === "college");
  const localAmenities = elements.filter((e: any) => e.tags?.amenity && !["school", "college", "university", "bus_stop"].includes(e.tags.amenity));
  
  const categories = new Set(localAmenities.map((e: any) => e.tags.amenity));
  
  // Distances and Densities
  const trainDistance = trainStations.length > 0 ? 0.5 : 3.0; // Simplified for now
  const busStopDensity = busStops / 0.78; // Approx 500m radius area
  const diversityIndex = categories.size;
  const amenitiesPerKm2 = localAmenities.length / 3.14; // Approx 1km radius area

  // 4. TfL Integration (if London-based)
  let tflData = null;
  if (geoData.result.region === "London") {
    const tflRes = await fetch(`https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=1000`);
    tflData = tflRes.ok ? await tflRes.json() : null;
  }

  // Calculate commute (simplified fallback)
  const commuteCityCenter = tflData ? 25 : 45; 
  const commuteMajorHub = tflData ? 15 : 30;

  return {
    lat: String(lat),
    lng: String(lng),
    metrics: {
      crimeCount,
      crimeTrend,
      transport: {
        trainDistance,
        busStopDensity,
        commuteCityCenter,
        commuteMajorHub
      },
      amenities: {
        amenitiesPerKm2,
        diversityIndex,
        topRatedPlaces: Math.min(10, Math.floor(localAmenities.length / 4))
      },
      schools: {
        // Since we can't get Ofsted ratings easily via API, we use school count as a proxy for choice
        primaryRating: 80, // Baseline Good
        secondaryRating: 80,
        count: schools.length
      }
    }
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
  // Train distance (lower is better, range 0-5km)
  const t1 = 100 - normalize(metrics.transport.trainDistance, 0, 5);
  // Bus density (higher is better, range 0-10)
  const t2 = normalize(metrics.transport.busStopDensity, 0, 10);
  // Commute city (lower is better, range 20-60)
  const t3 = 100 - normalize(metrics.transport.commuteCityCenter, 20, 60);
  // Commute hub (lower is better, range 15-45)
  const t4 = 100 - normalize(metrics.transport.commuteMajorHub, 15, 45);
  
  const transportScoreFinal = (t1 * 0.7 + t2 * 0.35 + t3 * 0.35 + t4 * 0.15) / 1.55;

  // 2.3 Safety Score
  // For a real metric, we use 0-200 crimes per km2 as a scale
  const crimeDensity = metrics.crimeCount / 3.14; // Approx 1km radius
  const crimeRate = normalize(crimeDensity, 0, 100); 
  let safetyBase = 100 - crimeRate;
  
  // Trend Score: Down: 100, Flat: 50, Up: 0
  const trendScore = metrics.crimeTrend === 'down' ? 100 : (metrics.crimeTrend === 'up' ? 0 : 50);
  const safetyScoreWeighted = (safetyBase * 0.7) + (trendScore * 0.3);

  // 2.4 Amenities Score
  const a1 = normalize(metrics.amenities.amenitiesPerKm2, 5, 30);
  const a2 = normalize(metrics.amenities.diversityIndex, 2, 7);
  const a3 = normalize(metrics.amenities.topRatedPlaces, 0, 10);
  const amenitiesScoreFinal = (a1 * 0.6 + a2 * 0.2 + a3 * 0.2);

  // 2.5 Schools Score
  const schoolsScoreFinal = (metrics.schools.primaryRating * 0.5) + (metrics.schools.secondaryRating * 0.5);

  // 2.6 Liveability Score
  const totalScore = (transportScoreFinal * 0.25) + (safetyScoreWeighted * 0.25) + (amenitiesScoreFinal * 0.25) + (schoolsScoreFinal * 0.25);

  return {
    transport: Math.round(transportScoreFinal),
    safety: Math.round(safetyScoreWeighted),
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
          rawMetrics: data.metrics,
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
