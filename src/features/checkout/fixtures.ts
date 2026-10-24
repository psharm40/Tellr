// fictional checkout fixtures for tests and local demos. all money is integer usd cents.
import type { CheckoutReview, CheckoutSnapshot, ShoppingPreferences } from "@/types/tellr";
import type { CheckoutRuleId } from "./evaluateCheckout";

export const SELECTED_LISTING_ID = "listing_demo_laptop_001";
export const OTHER_LISTING_ID = "listing_demo_laptop_002";

export const basePreferences: ShoppingPreferences = {
  category: "laptop",
  maxTotalCents: 30000,
  requirements: [
    { id: "req_charger", attribute: "chargerIncluded", operator: "equals", value: true, priority: "required" },
    { id: "req_delivery", attribute: "deliveryDate", operator: "at_most", value: "2026-11-01", priority: "required" },
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
    name: "item missing: no selected listing id",
    preferences: basePreferences,
    checkout: baseCheckout,
    expected: { overall: "needs_review", totalCents: 28563, checks: { item_match: "unknown" } },
  },
  {
    name: "fee change: higher shipping pushes total over budget",
    preferences: basePreferences,
    checkout: changed({ shippingCents: 4500 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 31563, checks: { budget: "fail" } },
  },
  {
    name: "tax unknown: total and budget cannot be confirmed",
    preferences: basePreferences,
    checkout: changed({ taxCents: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "needs_review", totalCents: null, checks: { total_known: "unknown", budget: "unknown" } },
  },
  {
    name: "tax unknown but known charges already over budget",
    preferences: basePreferences,
    checkout: changed({ taxCents: null, unitPriceCents: 29000, shippingCents: 1500 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: null, checks: { total_known: "unknown", budget: "fail" } },
  },
  {
    name: "unrequested add-on: flagged even though total stays in budget",
    preferences: basePreferences,
    checkout: changed({
      addOns: [{ id: "addon_protection", label: "protection plan", priceCents: 900, explicitlyAccepted: false }],
    }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 29463, checks: { add_ons: "fail" } },
  },
  {
    name: "accepted add-on: counted in total and allowed",
    preferences: basePreferences,
    checkout: changed({
      addOns: [{ id: "addon_case", label: "laptop sleeve", priceCents: 1200, explicitlyAccepted: true }],
    }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 29763, checks: { add_ons: "pass" } },
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
    expected: { overall: "needs_review", totalCents: 28563, checks: { delivery_date: "unknown" } },
  },
  {
    name: "delivery after deadline: blocked",
    preferences: basePreferences,
    checkout: changed({ estimatedDeliveryDate: "2026-11-05" }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 28563, checks: { delivery_date: "fail" } },
  },
  {
    name: "delivery date missing without a deadline: not required",
    preferences: { ...basePreferences, requirements: [basePreferences.requirements[0]] },
    checkout: changed({ estimatedDeliveryDate: null }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "pass", totalCents: 28563, checks: { delivery_date: "pass" } },
  },
  {
    name: "quantity above 1 without a quantity requirement: blocked",
    preferences: basePreferences,
    checkout: changed({ quantity: 2 }),
    selectedListingId: SELECTED_LISTING_ID,
    expected: { overall: "blocked", totalCents: 53563, checks: { quantity: "fail", budget: "fail" } },
  },
];
