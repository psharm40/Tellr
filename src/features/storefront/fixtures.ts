// DEVELOPMENT FIXTURE data, used only with ?fixtures=1 while a teammate's route is not merged yet.
// every value says it is a fixture so it can never pass for a real claude or checkout result.
import type {
  CheckoutReview,
  CheckoutSnapshot,
  Evidence,
  InspectionReport,
  Listing,
  ShoppingPreferences,
} from "@/types/tellr";

export function fixturePreferences(): { preferences: ShoppingPreferences; clarificationQuestions: string[] } {
  return {
    preferences: {
      category: "laptop",
      maxTotalCents: 30000,
      requirements: [
        { id: "req_screen", attribute: "screen_condition", operator: "equals", value: "no_cracks", priority: "required" },
        { id: "req_charger", attribute: "charger_included", operator: "equals", value: true, priority: "required" },
      ],
    },
    clarificationQuestions: [
      "DEVELOPMENT FIXTURE: your text was not parsed. These are the sample requirements from the demo script.",
    ],
  };
}

export function fixtureInspection(listing: Listing, preferences: ShoppingPreferences): { report: InspectionReport } {
  const evidence: Evidence[] = [
    ...listing.images.map((image) => ({
      id: `ev_fixture_${image.id}`,
      sourceType: "photo" as const,
      sourceId: image.id,
      observation: "DEVELOPMENT FIXTURE: this photo was not analyzed.",
    })),
    {
      id: "ev_fixture_description",
      sourceType: "description",
      sourceId: "listing-description",
      observation: "DEVELOPMENT FIXTURE: the seller's description was not analyzed.",
    },
  ];
  return {
    report: {
      listingId: listing.id,
      evidence,
      assessments: preferences.requirements.map((requirement) => ({
        requirementId: requirement.id,
        status: "unknown",
        explanation: "DEVELOPMENT FIXTURE: no real inspection ran, so this stays unknown.",
        evidenceIds: evidence.map((item) => item.id),
      })),
      sellerQuestions: [
        "Could you send a photo of the screen turned on?",
        "Could you send a photo of the included charger?",
      ],
    },
  };
}

export function fixtureReview(checkout: CheckoutSnapshot): { review: CheckoutReview } {
  return {
    review: {
      checkoutId: checkout.id,
      checkoutVersion: checkout.version,
      totalCents: null,
      checks: [
        {
          ruleId: "development_fixture",
          status: "unknown",
          explanation: "DEVELOPMENT FIXTURE: the checkout rules did not run. Nothing here was checked.",
        },
      ],
      overall: "needs_review",
      spokenSummary: "Development fixture. The checkout was not actually checked.",
    },
  };
}
