import { db } from "./db";
import {
  assessments,
  type InsertAssessment,
  type Assessment
} from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

export interface IStorage {
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  getAssessment(id: number): Promise<Assessment | undefined>;
  getAssessmentByPostcode(postcode: string): Promise<Assessment | undefined>;
  updateLastSearchedAt(id: number): Promise<void>;
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
}

export const storage = new DatabaseStorage();
