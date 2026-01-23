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
  lastSearchedAt: timestamp("last_searched_at").defaultNow(),
});

export const insertAssessmentSchema = createInsertSchema(assessments).extend({
  postcode: z.string().regex(postcodeRegex, "Please enter a valid UK postcode (e.g., SW1A 1AA)")
}).omit({ 
  id: true, 
  createdAt: true 
});

export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;

export const shareRequests = pgTable("share_requests", {
  id: serial("id").primaryKey(),
  assessmentId: serial("assessment_id").references(() => assessments.id),
  email: text("email").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const insertShareRequestSchema = createInsertSchema(shareRequests).extend({
  email: z.string().email("Please enter a valid email address")
}).omit({ 
  id: true, 
  sentAt: true 
});

export type ShareRequest = typeof shareRequests.$inferSelect;
export type InsertShareRequest = z.infer<typeof insertShareRequestSchema>;
