import { z } from "zod";
import { ISSUE_DECISIONS } from "@/domain/issueResolution";
import { LAB_DOCUMENT_STATUSES, REVIEW_STATUSES } from "@/domain/labReview";

/**
 * Allowed values of the String status columns in prisma/schema.prisma (SQLite has no enums).
 * Services parse stored values with these schemas before using them. See docs/DATA_MODEL.md.
 * Zone unit and condition use unitSchema and conditionSchema from src/domain/types.ts.
 */
export const labDocumentStatusSchema = z.enum(LAB_DOCUMENT_STATUSES);
export type LabDocumentStatus = z.infer<typeof labDocumentStatusSchema>;
export const aiRunKindSchema = z.enum(["EXTRACTION", "NARRATIVE"]);
export const aiRunStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED"]);
export const labResultOriginSchema = z.enum(["AI", "MANUAL"]);
export const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Confidence = z.infer<typeof confidenceSchema>;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export const issueDecisionSchema = z.enum(ISSUE_DECISIONS);
export const narrativeSourceSchema = z.enum(["AI_DRAFT", "EDITED"]);
export const revisionStatusSchema = z.enum(["GENERATING", "READY", "FAILED"]);
