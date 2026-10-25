// runtime validation schemas for the requirements api. these mirror the frozen
// contracts in src/types/tellr.ts exactly and never widen or rename them. zod is
// used only for validation — nothing here calls the anthropic api.

import { z } from "zod";
import type { ShoppingPreferences, ShoppingRequirement } from "@/types/tellr";

// canonical requirement attributes from the project specification (mvp laptop
// flow). do not add to this list without a coordinated shared-contract change.
export const CANONICAL_ATTRIBUTES = [
  "screen_condition",
  "charger_included",
  "cosmetic_scratches",
  "delivery_by_date",
  "quantity",
  "color",
  "no_unrequested_addons",
  "no_subscription",
] as const;

export type CanonicalAttribute = (typeof CANONICAL_ATTRIBUTES)[number];

// priority mirrors the frozen contract exactly.
const prioritySchema = z.enum(["required", "preference"]);

// a nonempty, trimmed string value (e.g. screen_condition "no_cracks", a color).
const stringValue = z.string().trim().min(1);

// quantity must be a positive whole number of items.
const quantityValue = z.number().int().min(1);

// checks that a YYYY-MM-DD string is also a real calendar date (utc, no timezone
// math), per the project's date convention.
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const dateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
  .refine(isRealCalendarDate, "date must be a valid calendar date");

// per-attribute operator sets. each is a subset of the frozen operator union
// ("equals" | "at_most" | "at_least" | "allowed"); no new operators are added.
const opEquals = z.enum(["equals"]);
const opEqualsOrAllowed = z.enum(["equals", "allowed"]);
const opEqualsOrAtMost = z.enum(["equals", "at_most"]);
const opQuantity = z.enum(["equals", "at_least", "at_most"]);

// a requirement draft: the canonical content of one requirement, without an id.
// the model produces these; ids are assigned deterministically in requirementIds.
// a discriminated union on `attribute` enforces the right value type per attribute.
export const requirementDraftSchema = z.discriminatedUnion("attribute", [
  z.object({ attribute: z.literal("screen_condition"), operator: opEquals, value: stringValue, priority: prioritySchema }),
  z.object({ attribute: z.literal("charger_included"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
  z.object({ attribute: z.literal("cosmetic_scratches"), operator: opEqualsOrAllowed, value: z.boolean(), priority: prioritySchema }),
  z.object({ attribute: z.literal("delivery_by_date"), operator: opEqualsOrAtMost, value: dateValue, priority: prioritySchema }),
  z.object({ attribute: z.literal("quantity"), operator: opQuantity, value: quantityValue, priority: prioritySchema }),
  z.object({ attribute: z.literal("color"), operator: opEquals, value: stringValue, priority: prioritySchema }),
  z.object({ attribute: z.literal("no_unrequested_addons"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
  z.object({ attribute: z.literal("no_subscription"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
]);

export type RequirementDraft = z.infer<typeof requirementDraftSchema>;

// a nonempty, trimmed requirement id.
const idSchema = z.string().trim().min(1);

// a fully-formed ShoppingRequirement (draft content plus a stable id). same
// per-attribute rules as the draft, with the id added to each member.
export const shoppingRequirementSchema = z.discriminatedUnion("attribute", [
  z.object({ id: idSchema, attribute: z.literal("screen_condition"), operator: opEquals, value: stringValue, priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("charger_included"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("cosmetic_scratches"), operator: opEqualsOrAllowed, value: z.boolean(), priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("delivery_by_date"), operator: opEqualsOrAtMost, value: dateValue, priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("quantity"), operator: opQuantity, value: quantityValue, priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("color"), operator: opEquals, value: stringValue, priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("no_unrequested_addons"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
  z.object({ id: idSchema, attribute: z.literal("no_subscription"), operator: opEquals, value: z.boolean(), priority: prioritySchema }),
]);

// budget: the shopper's total in integer cents, nonnegative, or null when absent.
const maxTotalCentsSchema = z.number().int().min(0).nullable();

// the category the shopper is shopping in (e.g. "laptop"); nonempty.
const categorySchema = z.string().trim().min(1);

// ShoppingPreferences with fully-formed requirements — the shape returned to the
// ui and handed to checkout. matches the frozen contract exactly.
export const shoppingPreferencesSchema = z.object({
  category: categorySchema,
  maxTotalCents: maxTotalCentsSchema,
  requirements: z.array(shoppingRequirementSchema),
});

// the raw, pre-id shape the model is asked to produce for requirement parsing:
// preferences with requirement drafts, plus clarification questions. ids and the
// final response envelope are assembled after validation (see requirementIds).
export const parsedRequirementsDraftSchema = z.object({
  category: categorySchema,
  maxTotalCents: maxTotalCentsSchema,
  requirements: z.array(requirementDraftSchema),
  clarificationQuestions: z.array(z.string().trim().min(1)),
});

export type ParsedRequirementsDraft = z.infer<typeof parsedRequirementsDraftSchema>;

// the exact success response of POST /api/requirements (see docs/API_CONTRACTS.md).
export const requirementsResponseSchema = z.object({
  preferences: shoppingPreferencesSchema,
  clarificationQuestions: z.array(z.string()),
});

export type RequirementsResponse = z.infer<typeof requirementsResponseSchema>;

// compile-time guard: fails to type-check if the zod schemas ever drift from the
// frozen contract types. never called at runtime; the return types do the work.
export function assertSchemasMatchContract(
  requirement: z.infer<typeof shoppingRequirementSchema>,
  preferences: z.infer<typeof shoppingPreferencesSchema>,
): [ShoppingRequirement, ShoppingPreferences] {
  return [requirement, preferences];
}
