// deterministic checkout checks. pure functions only: no network, no ai, no llm.
import type {
  CheckoutCheck,
  CheckoutCheckStatus,
  CheckoutReview,
  CheckoutSnapshot,
  ShoppingPreferences,
  ShoppingRequirement,
} from "@/types/tellr";
import { formatCents } from "./money";

// stable rule ids, in the order checks are reported
export const CHECKOUT_RULE_IDS = [
  "item_match",
  "total_known",
  "budget",
  "quantity",
  "add_ons",
  "subscription",
  "delivery_date",
] as const;

export type CheckoutRuleId = (typeof CHECKOUT_RULE_IDS)[number];

// requirement attributes this module understands; others are owned by inspection.
// note: these attribute names are a checkout-side convention, not yet in the shared contract.
export const QUANTITY_ATTRIBUTE = "quantity";
export const DELIVERY_DATE_ATTRIBUTE = "deliveryDate";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// item price times quantity, plus every add-on in the cart (accepted or not, it is still charged)
export function knownSubtotalCents(checkout: CheckoutSnapshot): number {
  const addOnCents = checkout.addOns.reduce((sum, a) => sum + a.priceCents, 0);
  return checkout.unitPriceCents * checkout.quantity + addOnCents;
}

// exact final total, or null while shipping or tax is unknown. never estimated.
export function computeTotalCents(checkout: CheckoutSnapshot): number | null {
  if (checkout.shippingCents === null || checkout.taxCents === null) return null;
  return knownSubtotalCents(checkout) + checkout.shippingCents + checkout.taxCents;
}

function check(
  ruleId: CheckoutRuleId,
  status: CheckoutCheckStatus,
  explanation: string,
): CheckoutCheck {
  return { ruleId, status, explanation };
}

function findRequirement(
  preferences: ShoppingPreferences,
  attribute: string,
): ShoppingRequirement | undefined {
  return preferences.requirements.find((r) => r.attribute === attribute);
}

function checkItemMatch(
  checkout: CheckoutSnapshot,
  selectedListingId: string | undefined,
): CheckoutCheck {
  if (selectedListingId === undefined) {
    return check(
      "item_match",
      "unknown",
      "the selected listing is unknown, so the item in checkout cannot be matched to the one you chose.",
    );
  }
  if (checkout.listingId === selectedListingId) {
    return check("item_match", "pass", "the item in checkout is the listing you selected.");
  }
  return check(
    "item_match",
    "fail",
    "the item in checkout is not the listing you selected.",
  );
}

function checkTotalKnown(checkout: CheckoutSnapshot, totalCents: number | null): CheckoutCheck {
  if (totalCents !== null) {
    return check("total_known", "pass", `the final total is ${formatCents(totalCents)}.`);
  }
  const missing = [
    checkout.shippingCents === null ? "shipping" : null,
    checkout.taxCents === null ? "tax" : null,
  ].filter(Boolean);
  return check(
    "total_known",
    "unknown",
    `the final total is unknown because ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not shown yet.`,
  );
}

function checkBudget(
  preferences: ShoppingPreferences,
  checkout: CheckoutSnapshot,
  totalCents: number | null,
): CheckoutCheck {
  const max = preferences.maxTotalCents;
  if (max === null) {
    return check("budget", "pass", "you did not set a maximum total.");
  }
  if (totalCents !== null) {
    return totalCents <= max
      ? check("budget", "pass", `the total of ${formatCents(totalCents)} is within your ${formatCents(max)} budget.`)
      : check(
          "budget",
          "fail",
          `the total of ${formatCents(totalCents)} is ${formatCents(totalCents - max)} over your ${formatCents(max)} budget.`,
        );
  }
  // shipping and tax are never negative, so known charges alone can already exceed the budget
  const known = knownSubtotalCents(checkout) + (checkout.shippingCents ?? 0) + (checkout.taxCents ?? 0);
  if (known > max) {
    return check(
      "budget",
      "fail",
      `known charges of ${formatCents(known)} already exceed your ${formatCents(max)} budget, before the missing costs.`,
    );
  }
  return check(
    "budget",
    "unknown",
    `the budget cannot be confirmed until the full total is known; known charges so far are ${formatCents(known)} of your ${formatCents(max)} budget.`,
  );
}

function checkQuantity(preferences: ShoppingPreferences, checkout: CheckoutSnapshot): CheckoutCheck {
  const q = checkout.quantity;
  const req = findRequirement(preferences, QUANTITY_ATTRIBUTE);
  if (req && typeof req.value === "number" && req.operator !== "allowed") {
    const ok =
      req.operator === "equals" ? q === req.value : req.operator === "at_most" ? q <= req.value : q >= req.value;
    const rule =
      req.operator === "equals" ? `exactly ${req.value}` : req.operator === "at_most" ? `at most ${req.value}` : `at least ${req.value}`;
    return ok
      ? check("quantity", "pass", `the quantity is ${q}, matching your request for ${rule}.`)
      : check("quantity", "fail", `the quantity is ${q}, but you asked for ${rule}.`);
  }
  // without a quantity requirement, a single item is expected
  return q === 1
    ? check("quantity", "pass", "the quantity is 1.")
    : check("quantity", "fail", `the quantity is ${q}, but only 1 item was expected.`);
}

function checkAddOns(checkout: CheckoutSnapshot): CheckoutCheck {
  const unrequested = checkout.addOns.filter((a) => !a.explicitlyAccepted);
  if (unrequested.length === 0) {
    return checkout.addOns.length === 0
      ? check("add_ons", "pass", "there are no extras in the cart.")
      : check("add_ons", "pass", "every extra in the cart was accepted by you.");
  }
  const list = unrequested.map((a) => `${a.label} (${formatCents(a.priceCents)})`).join(", ");
  return check("add_ons", "fail", `extras you did not accept were added: ${list}.`);
}

function checkSubscription(checkout: CheckoutSnapshot): CheckoutCheck {
  if (checkout.hasSubscription === null) {
    return check("subscription", "unknown", "it is unknown whether this checkout includes a subscription.");
  }
  if (checkout.hasSubscription) {
    // no shared field records subscription acceptance, so a subscription always blocks
    return check("subscription", "fail", "this checkout includes a subscription.");
  }
  return check("subscription", "pass", "there is no subscription.");
}

function checkDeliveryDate(preferences: ShoppingPreferences, checkout: CheckoutSnapshot): CheckoutCheck {
  const req = findRequirement(preferences, DELIVERY_DATE_ATTRIBUTE);
  if (!req || req.operator !== "at_most" || !isIsoDate(req.value)) {
    return check("delivery_date", "pass", "you did not set a delivery deadline.");
  }
  const deadline = req.value;
  const date = checkout.estimatedDeliveryDate;
  if (date === null) {
    return check(
      "delivery_date",
      "unknown",
      `the delivery date is not shown, so delivery by ${deadline} cannot be confirmed.`,
    );
  }
  // iso dates compare correctly as strings
  return date <= deadline
    ? check("delivery_date", "pass", `estimated delivery on ${date} meets your ${deadline} deadline.`)
    : check("delivery_date", "fail", `estimated delivery on ${date} is after your ${deadline} deadline.`);
}

function overallFrom(checks: CheckoutCheck[]): CheckoutReview["overall"] {
  if (checks.some((c) => c.status === "fail")) return "blocked";
  // every rule is critical: an unknown never passes
  if (checks.some((c) => c.status === "unknown")) return "needs_review";
  return "pass";
}

function spokenSummaryFrom(
  overall: CheckoutReview["overall"],
  totalCents: number | null,
  checks: CheckoutCheck[],
): string {
  const head =
    overall === "pass"
      ? "Checkout review passed."
      : overall === "blocked"
        ? "Checkout is blocked."
        : "Checkout needs review.";
  const total = totalCents === null ? "The final total is unknown." : `The final total is ${formatCents(totalCents)}.`;
  const sentence = (c: CheckoutCheck) => c.explanation.charAt(0).toUpperCase() + c.explanation.slice(1);
  const failed = checks.filter((c) => c.status === "fail").map(sentence);
  const unknown = checks.filter((c) => c.status === "unknown").map(sentence);
  const parts = [head, total];
  if (failed.length) parts.push(`Problems: ${failed.join(" ")}`);
  if (unknown.length) parts.push(`Still unknown: ${unknown.join(" ")}`);
  if (overall === "pass") parts.push("Everything matches your requirements. Say confirm to place the demo order.");
  return parts.join(" ");
}

export function evaluateCheckout(
  preferences: ShoppingPreferences,
  checkout: CheckoutSnapshot,
  selectedListingId?: string,
): CheckoutReview {
  const totalCents = computeTotalCents(checkout);
  const checks: CheckoutCheck[] = [
    checkItemMatch(checkout, selectedListingId),
    checkTotalKnown(checkout, totalCents),
    checkBudget(preferences, checkout, totalCents),
    checkQuantity(preferences, checkout),
    checkAddOns(checkout),
    checkSubscription(checkout),
    checkDeliveryDate(preferences, checkout),
  ];
  const overall = overallFrom(checks);
  return {
    checkoutId: checkout.id,
    checkoutVersion: checkout.version,
    totalCents,
    checks,
    overall,
    spokenSummary: spokenSummaryFrom(overall, totalCents, checks),
  };
}
