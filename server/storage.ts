import { db } from "./db";
import {
  assessments,
  type InsertAssessment,
  type Assessment
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  getAssessment(id: number): Promise<Assessment | undefined>;
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
}

export const storage = new DatabaseStorage();
