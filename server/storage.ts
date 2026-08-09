import { randomUUID } from "crypto";
import { db } from "./db";
import {
  assessments,
  shareRequests,
  userSearches,
  type InsertAssessment,
  type Assessment,
  type InsertShareRequest,
  type ShareRequest
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  createAssessment(assessment: InsertAssessment, existingId?: number, markRefreshed?: boolean): Promise<Assessment>;
  getAssessment(id: number): Promise<Assessment | undefined>;
  getAssessmentByToken(token: string): Promise<Assessment | undefined>;
  getAssessmentByPostcode(postcode: string): Promise<Assessment | undefined>;
  getPartialAssessments(): Promise<Assessment[]>;
  recordUserSearch(userId: string, assessmentId: number): Promise<void>;
  getAssessmentsByUser(userId: string): Promise<Assessment[]>;
  updateLastSearchedAt(id: number): Promise<void>;
  createShareRequest(request: InsertShareRequest): Promise<ShareRequest>;
  clearAllAssessments(): Promise<{ deletedAssessments: number; deletedUserSearches: number }>;
}

export class DatabaseStorage implements IStorage {
  async createAssessment(insertAssessment: InsertAssessment, existingId?: number, markRefreshed = false): Promise<Assessment> {
    if (existingId !== undefined) {
      const [updated] = await db
        .update(assessments)
        .set({
          lat: insertAssessment.lat,
          lng: insertAssessment.lng,
          rawMetrics: insertAssessment.rawMetrics,
          scores: insertAssessment.scores,
          partialData: insertAssessment.partialData ?? false,
          createdAt: new Date(),
          lastSearchedAt: new Date(),
          ...(markRefreshed ? { lastRefreshedAt: new Date() } : {}),
        })
        .where(eq(assessments.id, existingId))
        .returning();
      return updated;
    }

    const [assessment] = await db.insert(assessments)
      .values({ ...insertAssessment, shareToken: randomUUID() })
      .returning();
    return assessment;
  }

  async getAssessment(id: number): Promise<Assessment | undefined> {
    const [assessment] = await db.select()
      .from(assessments)
      .where(eq(assessments.id, id));
    return assessment;
  }

  async getAssessmentByToken(token: string): Promise<Assessment | undefined> {
    const [assessment] = await db.select()
      .from(assessments)
      .where(eq(assessments.shareToken, token));
    return assessment;
  }

  async getAssessmentByPostcode(postcode: string): Promise<Assessment | undefined> {
    const [assessment] = await db.select()
      .from(assessments)
      .where(eq(assessments.postcode, postcode))
      .limit(1);
    return assessment;
  }

  async getPartialAssessments(): Promise<Assessment[]> {
    return db.select()
      .from(assessments)
      .where(eq(assessments.partialData, true))
      .orderBy(desc(assessments.lastSearchedAt));
  }

  async recordUserSearch(userId: string, assessmentId: number): Promise<void> {
    await db.insert(userSearches)
      .values({ userId, assessmentId })
      .onConflictDoNothing();
  }

  async getAssessmentsByUser(userId: string): Promise<Assessment[]> {
    const rows = await db
      .select({ assessment: assessments, searchedAt: userSearches.searchedAt })
      .from(userSearches)
      .innerJoin(assessments, eq(userSearches.assessmentId, assessments.id))
      .where(eq(userSearches.userId, userId))
      .orderBy(desc(userSearches.searchedAt));
    return rows.map(r => r.assessment);
  }

  async updateLastSearchedAt(id: number): Promise<void> {
    await db.update(assessments)
      .set({ lastSearchedAt: new Date() })
      .where(eq(assessments.id, id));
  }

  async createShareRequest(insertRequest: InsertShareRequest): Promise<ShareRequest> {
    const [request] = await db.insert(shareRequests)
      .values(insertRequest)
      .returning();
    return request;
  }

  // Wipe all cached assessments (and the user-search links that point at them) so
  // every future postcode lookup recomputes from live data. Used by the admin
  // "clear cache" endpoint. Order matters: clear the FK-dependent table first.
  async clearAllAssessments(): Promise<{ deletedAssessments: number; deletedUserSearches: number }> {
    const removedSearches = await db.delete(userSearches).returning();
    const removedAssessments = await db.delete(assessments).returning();
    return {
      deletedAssessments: removedAssessments.length,
      deletedUserSearches: removedSearches.length,
    };
  }
}

export const storage = new DatabaseStorage();
