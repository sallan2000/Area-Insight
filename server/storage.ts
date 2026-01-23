import { db } from "./db";
import {
  assessments,
  shareRequests,
  type InsertAssessment,
  type Assessment,
  type InsertShareRequest,
  type ShareRequest
} from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

export interface IStorage {
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  getAssessment(id: number): Promise<Assessment | undefined>;
  getAssessmentByPostcode(postcode: string): Promise<Assessment | undefined>;
  updateLastSearchedAt(id: number): Promise<void>;
  createShareRequest(request: InsertShareRequest): Promise<ShareRequest>;
}

export class DatabaseStorage implements IStorage {
  async createAssessment(insertAssessment: InsertAssessment): Promise<Assessment> {
    const [assessment] = await db.insert(assessments)
      .values(insertAssessment)
      .returning();
    return assessment;
  }

  async getAssessment(id: number): Promise<Assessment | undefined> {
    const [assessment] = await db.select()
      .from(assessments)
      .where(eq(assessments.id, id));
    return assessment;
  }

  async getAssessmentByPostcode(postcode: string): Promise<Assessment | undefined> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [assessment] = await db.select()
      .from(assessments)
      .where(
        and(
          eq(assessments.postcode, postcode),
          gt(assessments.lastSearchedAt, thirtyDaysAgo)
        )
      )
      .limit(1);
    return assessment;
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
}

export const storage = new DatabaseStorage();
