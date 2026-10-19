import { z } from "zod";

/**
 * Allowed values of the String status columns in prisma/schema.prisma (SQLite has no enums).
 * Services parse stored values with these schemas before using them. See docs/DATA_MODEL.md.
 * Zone unit and condition use unitSchema and conditionSchema from src/domain/types.ts.
 */
/** UPLOADED → EXTRACTING → NEEDS_REVIEW → ACCEPTED, or FAILED from UPLOADED/EXTRACTING. */
export const labDocumentStatusSchema = z.enum(["UPLOADED", "EXTRACTING", "NEEDS_REVIEW", "ACCEPTED", "FAILED"]);
export type LabDocumentStatus = z.infer<typeof labDocumentStatusSchema>;
export const aiRunKindSchema = z.enum(["EXTRACTION", "NARRATIVE"]);
export const aiRunStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED"]);
export const labResultOriginSchema = z.enum(["AI", "MANUAL"]);
export const confidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Confidence = z.infer<typeof confidenceSchema>;
export const reviewStatusSchema = z.enum(["PENDING", "ACCEPTED", "REJECTED"]);
export const issueDecisionSchema = z.enum(["RESOLVED", "FLAGGED"]);
export const narrativeSourceSchema = z.enum(["AI_DRAFT", "EDITED"]);
export const revisionStatusSchema = z.enum(["GENERATING", "READY", "FAILED"]);
