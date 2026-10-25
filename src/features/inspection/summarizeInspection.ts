// conversational layer: turns a structured InspectionReport into a short, friendly,
// spoken-friendly explanation for the shopper — like a knowledgeable friend, not a
// technical report. this is derived output only: it does NOT change the frozen
// InspectionReport contract, add fields, or weaken any validation. the structured
// report remains the accurate source of truth; this just presents it in plain words.
//
// deterministic (no llm). it is careful to stay semantically accurate:
// - it reads each requirement's actual operator and value, not just its attribute.
// - a "supported" screen check means the screen looks crack-free, not that the whole
//   laptop is undamaged.
// - if the shopper allows scratches, it never calls the exterior "clean".
// - if a charger isn't pictured, it never implies it definitely isn't included.
// - it only says something is visible "in the photos" when photo evidence backs it;
//   support that rests on seller text is phrased as a listing claim.
// - serious contradictions of REQUIRED requirements lead over minor positives.

import type {
  Evidence,
  InspectionReport,
  Listing,
  RequirementAssessment,
  ShoppingPreferences,
  ShoppingRequirement,
} from "@/types/tellr";

function requirementFor(
  preferences: ShoppingPreferences,
  requirementId: string,
): ShoppingRequirement | undefined {
  return preferences.requirements.find((r) => r.id === requirementId);
}

// true when at least one evidence item backing this assessment is an actual photo.
function isPhotoBacked(
  assessment: RequirementAssessment,
  evidenceById: Map<string, Evidence>,
): boolean {
  return assessment.evidenceIds.some(
    (id) => evidenceById.get(id)?.sourceType === "photo",
  );
}

type Kind = "good" | "concern" | "check" | "unsure";

function kindFor(status: string): Kind {
  if (status === "supported") return "good";
  if (status === "contradicted") return "concern";
  if (status === "seller_claimed") return "check";
  return "unsure"; // unknown
}

// lower number = earlier. serious contradictions of required requirements lead.
function severityFor(status: string, priority: string): number {
  if (status === "contradicted" && priority === "required") return 0;
  if (status === "supported") return 1;
  if (status === "contradicted") return 2; // contradicted preference (minor)
  if (status === "seller_claimed") return 3;
  return 4; // unknown
}

// builds one bare, natural clause (no leading capital) for an assessment, accounting
// for the requirement's value/operator and whether photo evidence backs it. returns
// null for attributes/values it cannot phrase.
function clauseFor(
  status: string,
  req: ShoppingRequirement,
  photo: boolean,
): string | null {
  const v = req.value;
  switch (req.attribute) {
    case "screen_condition":
      // "supported" here is narrow: the screen looks crack-free, not the whole laptop.
      if (status === "supported")
        return photo
          ? "the screen looks free of cracks in the photos, which was one of your must-haves"
          : "the listing describes the screen as crack-free, which is what you wanted";
      if (status === "contradicted")
        return "the screen looks cracked or damaged, which you specifically wanted to avoid — a cracked screen is costly to fix and hard to read";
      if (status === "seller_claimed")
        return "the seller says the screen is fine, but I can't confirm that from the photos";
      return "I can't tell what condition the screen is in from these photos";

    case "charger_included":
      if (status === "supported")
        return photo
          ? "a charger is visible in the photos, like you wanted"
          : "the listing lists a charger, like you wanted";
      if (status === "contradicted")
        return "the listing indicates a charger isn't included, which you needed";
      if (status === "seller_claimed")
        // not pictured: do NOT imply it definitely isn't included.
        return "the seller says a charger's included, but I can't see one in the photos, so I'd confirm it";
      return "I can't tell whether a charger's included";

    case "cosmetic_scratches": {
      const wantsNoScratches = v === false;
      if (wantsNoScratches) {
        if (status === "supported")
          return photo
            ? "the outside looks free of scratches, like you wanted"
            : "the listing describes the outside as scratch-free";
        if (status === "contradicted")
          return "there are visible scratches, which you wanted to avoid";
        if (status === "seller_claimed")
          return "the seller says there are no scratches, but I can't verify that from the photos";
        return "I can't tell how scratched the body is";
      }
      // scratches are acceptable to the shopper — never call it "clean".
      if (status === "supported")
        return "you're okay with some scratches, and any wear looks within that";
      if (status === "contradicted")
        return "there's more than light cosmetic wear — it looks damaged";
      if (status === "seller_claimed")
        return "the seller describes the cosmetic condition, but I can't fully verify it from the photos";
      return "I can't tell how scuffed the body is";
    }

    case "no_subscription":
      if (status === "supported")
        return photo
          ? "there doesn't appear to be a subscription, like you wanted"
          : "the listing says there's no subscription, like you wanted";
      if (status === "contradicted")
        return "it looks like there's a subscription, which you wanted to avoid — that means ongoing charges";
      if (status === "seller_claimed")
        return "the seller says there's no subscription, but that can't be seen in a photo, so I'd confirm it";
      return "I can't tell whether a subscription's attached";

    case "no_unrequested_addons":
      if (status === "supported") return "there are no surprise add-ons, like you wanted";
      if (status === "contradicted")
        return "there look to be extra add-ons you didn't ask for — those can quietly add cost";
      if (status === "seller_claimed")
        return "the seller says there are no extra add-ons, but I can't verify that from the photos";
      return "I can't tell whether any extras are bundled in";

    case "delivery_by_date": {
      const d = String(v);
      if (status === "supported") return `it should arrive by your date (${d})`;
      if (status === "contradicted") return `it may not arrive by your date (${d})`;
      if (status === "seller_claimed")
        return `the seller says it'll arrive by ${d}, but I can't confirm the timing`;
      return "I can't tell when it would actually arrive";
    }

    case "quantity": {
      const qty = req.operator === "at_least" ? `at least ${v}` : req.operator === "at_most" ? `up to ${v}` : `${v}`;
      if (status === "supported") return `you'd get the quantity you wanted (${qty})`;
      if (status === "contradicted") return `the quantity doesn't match what you wanted (${qty})`;
      if (status === "seller_claimed") return "the seller lists the quantity, but I can't verify it";
      return "I can't tell how many you'd get";
    }

    case "color": {
      const c = String(v);
      if (status === "supported")
        return photo
          ? `the color looks like the ${c} you wanted`
          : `the listing lists the color as ${c}, like you wanted`;
      if (status === "contradicted") return `the color looks different from the ${c} you wanted`;
      if (status === "seller_claimed") return `the seller says it's ${c}, but colors can look different in person`;
      return "I can't tell the exact color";
    }

    default:
      if (status === "supported") return "that checks out";
      if (status === "contradicted") return "there's an issue with that, which matters to you";
      if (status === "seller_claimed") return "the seller claims this, but I can't confirm it from the photos";
      return "I'm not sure about that";
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// turns an inspection report into a short, friendly, spoken-friendly summary. stays
// accurate to the assessments and brief enough to speak.
export function summarizeInspectionForShopper(
  report: InspectionReport,
  preferences: ShoppingPreferences,
  listing?: Listing,
): string {
  const item = listing?.title?.trim() ? listing.title.trim() : "this laptop";

  if (report.assessments.length === 0) {
    return `I couldn't check your specific requirements on ${item} from these photos yet — it'd help to add a few clear, well-lit pictures.`;
  }

  const evidenceById = new Map(report.evidence.map((e) => [e.id, e]));

  const entries = report.assessments
    .map((a) => {
      const req = requirementFor(preferences, a.requirementId);
      if (!req) return null;
      const clause = clauseFor(a.status, req, isPhotoBacked(a, evidenceById));
      if (!clause) return null;
      return { kind: kindFor(a.status), severity: severityFor(a.status, req.priority), clause };
    })
    .filter((e): e is { kind: Kind; severity: number; clause: string } => e !== null)
    .sort((a, b) => a.severity - b.severity)
    // cap to keep it short enough to sound natural when spoken aloud.
    .slice(0, 3);

  // assemble with varied openers so it doesn't read repetitively.
  let sawConcern = false;
  let sawGood = false;
  const sentences = entries.map((e) => {
    if (e.kind === "concern") {
      const opener = sawConcern ? "Another thing: " : "Heads up — ";
      sawConcern = true;
      return `${opener}${e.clause}.`;
    }
    if (e.kind === "good") {
      const opener = sawConcern || sawGood ? "On the plus side, " : "Good news: ";
      sawGood = true;
      return `${opener}${e.clause}.`;
    }
    // "check" and "unsure" clauses are self-contained; just capitalize.
    return `${cap(e.clause)}.`;
  });

  const parts = [`Here's my read on ${item}:`, ...sentences];

  const question = report.sellerQuestions.find((q) => q.trim().length > 0);
  if (question) {
    parts.push(`If it were me, I'd ask the seller: ${question.trim()}`);
  }

  return parts.join(" ");
}
