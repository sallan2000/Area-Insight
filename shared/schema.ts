import { pgTable, text, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/i;

export const assessments = pgTable("assessments", {
  id: serial("id").primaryKey(),
  postcode: text("postcode").notNull(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  rawMetrics: jsonb("raw_metrics").notNull(), // Stores raw data counts
  scores: jsonb("scores").notNull(), // Stores calculated 0-100 scores
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAssessmentSchema = createInsertSchema(assessments).extend({
  postcode: z.string().regex(postcodeRegex, "Please enter a valid UK postcode (e.g., SW1A 1AA)")
}).omit({ 
  id: true, 
  createdAt: true 
});

export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;

export type AssessmentResponse = Assessment;
