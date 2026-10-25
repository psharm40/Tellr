// runtime validation schemas for the inspection flow. these mirror the frozen
// contracts in src/types/tellr.ts exactly (Listing, Evidence, RequirementAssessment,
// InspectionReport) and never widen or rename them. zod is used only for validation.

import { z } from "zod";
import type { InspectionReport, Listing } from "@/types/tellr";
import { MAX_IMAGES } from "./imageValidation";
import { shoppingPreferencesSchema } from "./schemas";

// --- request shapes -------------------------------------------------------

// a listing image. the url is validated structurally here; data-url decoding and
// size limits are enforced separately in imageValidation (kept out of the hot path).
const listingImageSchema = z.object({
  id: z.string().trim().min(1),
  url: z.string().min(1),
  alt: z.string(),
});

// a listing to inspect. prices are integer cents; 1 to MAX_IMAGES images, the same limit
// imageValidation enforces, so the two checks can't disagree.
export const listingSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string(),
  category: z.string().trim().min(1),
  itemPriceCents: z.number().int().min(0),
  currency: z.literal("USD"),
  images: z.array(listingImageSchema).min(1).max(MAX_IMAGES),
});

// POST /api/inspection request body.
export const inspectionRequestSchema = z.object({
  listing: listingSchema,
  preferences: shoppingPreferencesSchema,
});

export type InspectionRequest = z.infer<typeof inspectionRequestSchema>;

// --- report shapes (model output, re-validated before returning) ----------

const evidenceSchema = z.object({
  id: z.string().trim().min(1),
  sourceType: z.enum(["photo", "description", "seller_response"]),
  sourceId: z.string().trim().min(1),
  observation: z.string().trim().min(1),
});

const requirementAssessmentSchema = z.object({
  requirementId: z.string().trim().min(1),
  status: z.enum(["supported", "seller_claimed", "contradicted", "unknown"]),
  explanation: z.string().trim().min(1),
  evidenceIds: z.array(z.string().trim().min(1)),
  followUpQuestion: z.string().trim().min(1).optional(),
});

// matches the frozen InspectionReport contract exactly.
export const inspectionReportSchema = z.object({
  listingId: z.string().trim().min(1),
  evidence: z.array(evidenceSchema),
  assessments: z.array(requirementAssessmentSchema),
  sellerQuestions: z.array(z.string().trim().min(1)),
});

export type ParsedInspectionReport = z.infer<typeof inspectionReportSchema>;

// compile-time guards: fail to type-check if the zod schemas drift from the frozen
// contract types. never called at runtime; the return types do the work.
export function assertInspectionSchemasMatchContract(
  report: z.infer<typeof inspectionReportSchema>,
  listing: z.infer<typeof listingSchema>,
): [InspectionReport, Listing] {
  return [report, listing];
}
