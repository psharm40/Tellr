// fictional checkout fixtures for tests and local demos. all money is integer usd cents.
import type { CheckoutReview, CheckoutSnapshot, ShoppingPreferences } from "@/types/tellr";
import type { CheckoutRuleId } from "./evaluateCheckout";

export const SELECTED_LISTING_ID = "listing_demo_laptop_001";
export const OTHER_LISTING_ID = "listing_demo_laptop_002";

export const basePreferences: ShoppingPreferences = {
  category: "laptop",
  maxTotalCents: 30000,
  requirements: [
    { id: "req_charger", attribute: "charger_included", operator: "equals", value: true, priority: "required" },
    { id: "req_delivery", attribute: "delivery_by_date", operator: "at_most", value: "2026-11-01", priority: "required" },
  ],
};

// 25000 + 1500 shipping + 2063 tax = 28563, under the 30000 budget
export const baseCheckout: CheckoutSnapshot = {
  id: "checkout_demo_001",
  version: 1,
  listingId: SELECTED_LISTING_ID,
  currency: "USD",
  quantity: 1,
  unitPriceCents: 25000,
  shippingCents: 1500,
  taxCents: 2063,
  addOns: [],
  hasSubscription: false,
  estimatedDeliveryDate: "2026-10-29",
};

// a changed checkout always gets a new version
function changed(patch: Partial<CheckoutSnapshot>): CheckoutSnapshot {
  return { ...baseCheckout, ...patch, version: baseCheckout.version + 1 };
}

export interface CheckoutFixture {
  name: string;
  preferences: ShoppingPreferences;
  checkout: CheckoutSnapshot;
  selectedListingId?: string;
  expected: {
    overall: CheckoutReview["overall"];
    totalCents: number | null;
    // only the rules a fixture is about; every other rule is expected to pass
    checks: Partial<Record<CheckoutRuleId, CheckoutReview["checks"][number]["status"]>>;
  };
}

export const checkoutFixtures: CheckoutFixture[] = [
  {
    name: "item match: checkout listing equals selected listing",
    preferences: basePreferences,
    checkout: baseCheckout,
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 28563, checks: { item_match: "pass" } },
  },
  {
    name: "item mismatch: checkout listing differs from selected listing",
    preferences: basePreferences,
    checkout: changed({ listingId: OTHER_LISTING_ID }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 28563, checks: { item_match: "fail" } },
  },
  {
    // the routes return 400 for this request (see the route fixtures below); the evaluator stays defensive
    name: "item missing: no selected listing id (direct call only)",
    preferences: basePreferences,
    checkout: baseCheckout,
    expected: { overall: "needs_review", totalCents: 28563, checks: { item_match: "unknown" } },
  },
  {
    name: "fee change: higher shipping pushes total over budget",
    preferences: basePreferences,
    checkout: changed({ shippingCents: 4500 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 31563, checks: { total_budget: "fail" } },
  },
  {
    name: "tax unknown: total and budget cannot be confirmed",
    preferences: basePreferences,
    checkout: changed({ taxCents: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "needs_review", totalCents: null, checks: { total_budget: "unknown", price_breakdown: "unknown" } },
  },
  {
    name: "tax unknown but known charges already over budget",
    preferences: basePreferences,
    checkout: changed({ taxCents: null, unitPriceCents: 29000, shippingCents: 1500 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: null, checks: { total_budget: "fail", price_breakdown: "unknown" } },
  },
  {
    name: "unrequested add-on: flagged even though total stays in budget",
    preferences: basePreferences,
    checkout: changed({
      addOns: [{ id: "addon_protection", label: "protection plan", priceCents: 900, explicitlyAccepted: false }],
    }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 29463, checks: { unexpected_addons: "fail" } },
  },
  {
    name: "accepted add-on: counted in total and allowed",
    preferences: basePreferences,
    checkout: changed({
      addOns: [{ id: "addon_case", label: "laptop sleeve", priceCents: 1200, explicitlyAccepted: true }],
    }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 29763, checks: { unexpected_addons: "pass" } },
  },
  {
    name: "subscription present: blocked",
    preferences: basePreferences,
    checkout: changed({ hasSubscription: true }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 28563, checks: { subscription: "fail" } },
  },
  {
    name: "subscription unknown: needs review",
    preferences: basePreferences,
    checkout: changed({ hasSubscription: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "needs_review", totalCents: 28563, checks: { subscription: "unknown" } },
  },
  {
    name: "delivery date missing with a deadline: unknown",
    preferences: basePreferences,
    checkout: changed({ estimatedDeliveryDate: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "needs_review", totalCents: 28563, checks: { delivery: "unknown" } },
  },
  {
    name: "delivery after deadline: blocked",
    preferences: basePreferences,
    checkout: changed({ estimatedDeliveryDate: "2026-11-05" }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 28563, checks: { delivery: "fail" } },
  },
  {
    name: "delivery date missing without a deadline: not required",
    preferences: { ...basePreferences, requirements: [basePreferences.requirements[0]] },
    checkout: changed({ estimatedDeliveryDate: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 28563, checks: { delivery: "pass" } },
  },
  {
    name: "quantity 2 without a quantity requirement: passes and is disclosed",
    preferences: { ...basePreferences, maxTotalCents: 60000 },
    checkout: changed({ quantity: 2 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 53563, checks: { quantity: "pass" } },
  },
  {
    name: "quantity above an at_most quantity requirement: blocked",
    preferences: {
      ...basePreferences,
      maxTotalCents: 60000,
      requirements: [
        ...basePreferences.requirements,
        { id: "req_qty", attribute: "quantity", operator: "at_most", value: 1, priority: "required" },
      ],
    },
    checkout: changed({ quantity: 2 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 53563, checks: { quantity: "fail" } },
  },
  {
    name: "unreadable delivery_by_date requirement: unknown, never assumed",
    preferences: {
      ...basePreferences,
      requirements: [
        { id: "req_delivery", attribute: "delivery_by_date", operator: "at_most", value: "next week", priority: "required" },
      ],
    },
    checkout: baseCheckout,
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "needs_review", totalCents: 28563, checks: { delivery: "unknown" } },
  },
];

// request bodies for the http routes. the item_match cases differ from evaluateCheckout:
// a missing selected listing id is rejected with 400 before any review runs.
export interface RouteRequestFixture {
  name: string;
  route: "review" | "confirm";
  body: Record<string, unknown>;
  expectedStatus: number;
  expectedOverall?: CheckoutReview["overall"];
}

const reviewBody = { preferences: basePreferences, checkout: baseCheckout };
const confirmBody = { ...reviewBody, reviewedVersion: 1, explicitConsent: true };

export const routeRequestFixtures: RouteRequestFixture[] = [
  { name: "review: ids match", route: "review", body: { ...reviewBody, selectedListingId: SELECTED_LISTING_ID }, expectedStatus: 200, expectedOverall: "pass" },
  { name: "review: ids differ", route: "review", body: { ...reviewBody, selectedListingId: OTHER_LISTING_ID }, expectedStatus: 200, expectedOverall: "blocked" },
  { name: "review: id missing", route: "review", body: reviewBody, expectedStatus: 400 },
  { name: "review: id null", route: "review", body: { ...reviewBody, selectedListingId: null }, expectedStatus: 400 },
  { name: "review: id blank", route: "review", body: { ...reviewBody, selectedListingId: "  " }, expectedStatus: 400 },
  { name: "review: id not a string", route: "review", body: { ...reviewBody, selectedListingId: 42 }, expectedStatus: 400 },
  { name: "confirm: ids match", route: "confirm", body: { ...confirmBody, selectedListingId: SELECTED_LISTING_ID }, expectedStatus: 200 },
  { name: "confirm: ids differ", route: "confirm", body: { ...confirmBody, selectedListingId: OTHER_LISTING_ID }, expectedStatus: 409 },
  { name: "confirm: id missing", route: "confirm", body: confirmBody, expectedStatus: 400 },
];
