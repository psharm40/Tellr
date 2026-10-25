// deterministic requirement id assignment. turns validated requirement drafts
// into fully-formed ShoppingRequirement objects with stable, unique ids. pure and
// independent of any anthropic api call.
//
// the id is an injective (reversible) encoding of a requirement's complete
// canonical content — attribute, operator, value, and priority. because the
// encoding is one-to-one:
// - deterministic: the same content always yields the same id.
// - position-independent: an id depends only on that one requirement, so it is
//   unchanged when other requirements are added, removed, or reordered.
// - collision-free by construction: distinct canonical content always yields
//   distinct ids, so no hashing or collision-resolution logic is needed.
// - exact duplicates (identical content, priority included) collapse to one id
//   and are dropped; anything that differs in any field is a distinct id and is
//   preserved.

import type { ShoppingRequirement } from "@/types/tellr";
import type { RequirementDraft } from "./schemas";

// encodes a value with a type tag so a string, number, or boolean can never
// collide (e.g. the string "2" vs the number 2). encodeURIComponent keeps the
// string content reversible and free of the "|" delimiter used below.
function valueToken(value: string | number | boolean): string {
  if (typeof value === "string") return `s:${encodeURIComponent(value)}`;
  if (typeof value === "boolean") return `b:${value}`;
  return `n:${value}`;
}

// builds the canonical, injective id for one requirement. every component is
// encodeURIComponent-escaped and joined with "|"; since encodeURIComponent always
// escapes "|", no component can contain the delimiter, so the join is reversible
// and distinct content always produces distinct ids.
function requirementId(draft: RequirementDraft): string {
  return [
    "req",
    encodeURIComponent(draft.attribute),
    encodeURIComponent(draft.operator),
    valueToken(draft.value),
    encodeURIComponent(draft.priority),
  ].join("|");
}

// assigns deterministic, unique ids to validated requirement drafts, preserving
// the shopper's original (voice-first) order.
export function assignRequirementIds(
  drafts: RequirementDraft[],
): ShoppingRequirement[] {
  const seenIds = new Set<string>();
  const requirements: ShoppingRequirement[] = [];

  for (const draft of drafts) {
    const id = requirementId(draft);
    // same id means byte-identical canonical content — an exact duplicate that
    // carries no new information, so we collapse it. conflicting requirements
    // (any difference in attribute, operator, value, or priority) get a distinct
    // id and are kept.
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    requirements.push({
      id,
      attribute: draft.attribute,
      operator: draft.operator,
      value: draft.value,
      priority: draft.priority,
    });
  }

  return requirements;
}
