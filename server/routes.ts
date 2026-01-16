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

  // 2. Fetch Crime Data (Real)
  const crimeRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`);
  const crimes = crimeRes.ok ? await crimeRes.json() : [];
  const crimeCount = crimes.length;
  
  // Calculate trend (mocked for now)
  const crimeTrend = Math.random() > 0.5 ? "stable" : (Math.random() > 0.5 ? "up" : "down");

  // 3. Mock other detailed metrics based on seed
  const seed = Math.abs(lat + lng);
  
  // Transport factors
  const trainDistance = (seed * 10) % 5; // 0-5km
  const busStopDensity = (seed * 100) % 10; // 0-10 per km2
  const commuteCityCenter = 20 + (seed * 100) % 40; // 20-60 mins
  const commuteMajorHub = 15 + (seed * 100) % 30; // 15-45 mins

  // Amenities factors
  const amenitiesPerKm2 = 5 + (seed * 100) % 25; // 5-30
  const amenityCategories = ["cafe", "park", "gym", "grocery", "pharmacy", "library", "restaurant"];
  const diversityIndex = Math.floor(2 + (seed * 10) % 5); // 2-7
  const topRatedPlaces = Math.floor((seed * 10) % 10); // 0-10

  // School factors (Ofsted ratings: 100, 80, 40, 20)
  const ratings = [100, 80, 40, 20];
  const primaryRating = ratings[Math.floor(seed * 10) % 4];
  const secondaryRating = ratings[Math.floor(seed * 20) % 4];

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
        topRatedPlaces
      },
      schools: {
        primaryRating,
        secondaryRating
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
  const crimeRate = normalize(metrics.crimeCount, 0, 200); // Mocking rate based on count for demo
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
