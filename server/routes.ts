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
  // Fetch crimes for last month at location
  const crimeRes = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`);
  const crimes = crimeRes.ok ? await crimeRes.json() : [];
  const crimeCount = crimes.length;
  
  // Calculate trend (mocked for now as we need historical data for real trend)
  const crimeTrend = Math.random() > 0.5 ? "stable" : (Math.random() > 0.5 ? "up" : "down");

  // 3. Mock other data for now (Transport, Schools, Amenities) 
  // In a full app, we would query OSM or other specific APIs
  // Generating deterministic-ish mock data based on lat/lng to be consistent
  const seed = Math.abs(lat + lng); 
  
  const transportCount = Math.floor((seed * 1000) % 20) + 5; // 5-25 stops
  const schoolCount = Math.floor((seed * 500) % 10) + 1; // 1-11 schools
  const amenityCount = Math.floor((seed * 2000) % 50) + 10; // 10-60 amenities

  // Diversity index (mocked)
  const amenityDiversity = Math.floor(amenityCount / 5); 

  return {
    lat: String(lat),
    lng: String(lng),
    metrics: {
      crimeCount,
      crimeTrend,
      transportCount,
      schoolCount,
      amenityCount,
      amenityDiversity
    }
  };
}

// Scoring Logic
function calculateScores(metrics: any) {
  // Normalization helper (clamped 0-100)
  // formula: score = 100 * (x - min) / (max - min)
  const normalize = (val: number, min: number, max: number) => {
    if (max === min) return 50;
    const score = 100 * ((val - min) / (max - min));
    return Math.min(100, Math.max(0, score));
  };

  // 2.2 Transport Score (0-30 stops range)
  const transportScore = normalize(metrics.transportCount, 0, 30);

  // 2.3 Safety Score (Low crime is better)
  // Inverse normalization: 0 crimes = 100, 200 crimes = 0
  let safetyScore = 100 - normalize(metrics.crimeCount, 0, 200);
  
  // Trend adjustment
  if (metrics.crimeTrend === 'down') safetyScore += 10;
  if (metrics.crimeTrend === 'up') safetyScore -= 10;
  safetyScore = Math.min(100, Math.max(0, safetyScore));

  // 2.4 Amenities Score (Diversity index)
  const amenitiesScore = normalize(metrics.amenityDiversity, 0, 15);

  // 2.5 Schools Score (Mocked average rating)
  // Assuming a mix of ratings, we'll just generate a score based on count for now
  // In real app, we'd average the Ofsted scores
  const schoolsScore = normalize(metrics.schoolCount, 0, 10) * 0.8 + 20; // Base baseline

  // 2.6 Liveability Score (Weighted Average)
  // Weights: T=25%, S=25%, A=25%, E=25%
  const totalScore = (
    (transportScore * 0.25) +
    (safetyScore * 0.25) +
    (amenitiesScore * 0.25) +
    (schoolsScore * 0.25)
  );

  return {
    transport: Math.round(transportScore),
    safety: Math.round(safetyScore),
    amenities: Math.round(amenitiesScore),
    schools: Math.round(schoolsScore),
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
