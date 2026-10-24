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
  "total_budget",
  "item_match",
  "quantity",
  "unexpected_addons",
  "subscription",
  "delivery",
  "price_breakdown",
] as const;

export type CheckoutRuleId = (typeof CHECKOUT_RULE_IDS)[number];

// requirement attribute strings from the checkout spec; other attributes belong to inspection
export const QUANTITY_ATTRIBUTE = "quantity";
export const DELIVERY_BY_DATE_ATTRIBUTE = "delivery_by_date";

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

export function itemCents(checkout: CheckoutSnapshot): number {
  return checkout.unitPriceCents * checkout.quantity;
}

// every add-on in the cart is charged, whether or not the shopper accepted it
export function addOnCents(checkout: CheckoutSnapshot): number {
  return checkout.addOns.reduce((sum, a) => sum + a.priceCents, 0);
}

// items plus add-ons plus whichever of shipping and tax are known
export function knownChargesCents(checkout: CheckoutSnapshot): number {
  return itemCents(checkout) + addOnCents(checkout) + (checkout.shippingCents ?? 0) + (checkout.taxCents ?? 0);
}

// exact final total, or null while shipping or tax is unknown. never estimated.
export function computeTotalCents(checkout: CheckoutSnapshot): number | null {
  if (checkout.shippingCents === null || checkout.taxCents === null) return null;
  return knownChargesCents(checkout);
}

function check(ruleId: CheckoutRuleId, status: CheckoutCheckStatus, explanation: string): CheckoutCheck {
  return { ruleId, status, explanation };
}

function findRequirement(preferences: ShoppingPreferences, attribute: string): ShoppingRequirement | undefined {
  return preferences.requirements.find((r) => r.attribute === attribute);
}

function missingCosts(checkout: CheckoutSnapshot): string {
  const missing = [checkout.shippingCents === null ? "shipping" : null, checkout.taxCents === null ? "tax" : null].filter(
    Boolean,
  );
  return `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"}`;
}

// one check for the final total and the budget: the budget cannot pass while the total is unknown
function checkTotalBudget(
  preferences: ShoppingPreferences,
  checkout: CheckoutSnapshot,
  totalCents: number | null,
): CheckoutCheck {
  const max = preferences.maxTotalCents;
  if (totalCents === null) {
    const known = knownChargesCents(checkout);
    const missing = missingCosts(checkout);
    // shipping and tax are never negative, so known charges alone can already exceed the budget
    if (max !== null && known > max) {
      return check(
        "total_budget",
        "fail",
        `known charges of ${formatCents(known)} already exceed your ${formatCents(max)} budget, and ${missing} still not shown.`,
      );
    }
    const budgetPart = max === null ? "" : `; known charges so far are ${formatCents(known)} of your ${formatCents(max)} budget`;
    return check("total_budget", "unknown", `the final total is unknown because ${missing} not shown yet${budgetPart}.`);
  }
  if (max === null) {
    return check("total_budget", "pass", `the final total is ${formatCents(totalCents)}; you did not set a maximum total.`);
  }
  return totalCents <= max
    ? check("total_budget", "pass", `the final total of ${formatCents(totalCents)} is within your ${formatCents(max)} budget.`)
    : check(
        "total_budget",
        "fail",
        `the final total of ${formatCents(totalCents)} is ${formatCents(totalCents - max)} over your ${formatCents(max)} budget.`,
      );
}

// defensive: the routes reject a missing id, but direct callers still get unknown, never pass
function checkItemMatch(checkout: CheckoutSnapshot, selectedListingId: string | undefined): CheckoutCheck {
  if (selectedListingId === undefined || selectedListingId === "") {
    return check(
      "item_match",
      "unknown",
      "the selected listing is unknown, so the item in checkout cannot be matched to the one you chose.",
    );
  }
  return checkout.listingId === selectedListingId
    ? check("item_match", "pass", "the item in checkout is the listing you selected.")
    : check("item_match", "fail", "the item in checkout is not the listing you selected.");
}

function checkQuantity(preferences: ShoppingPreferences, checkout: CheckoutSnapshot): CheckoutCheck {
  const q = checkout.quantity;
  const req = findRequirement(preferences, QUANTITY_ATTRIBUTE);
  if (!req) {
    // no quantity requirement: any positive quantity passes and is disclosed
    return check("quantity", "pass", `the quantity is ${q}.`);
  }
  if (typeof req.value !== "number" || req.operator === "allowed") {
    return check("quantity", "unknown", `the quantity is ${q}, but your quantity requirement could not be read.`);
  }
  const ok = req.operator === "equals" ? q === req.value : req.operator === "at_most" ? q <= req.value : q >= req.value;
  const rule =
    req.operator === "equals" ? `exactly ${req.value}` : req.operator === "at_most" ? `at most ${req.value}` : `at least ${req.value}`;
  return ok
    ? check("quantity", "pass", `the quantity is ${q}, matching your request for ${rule}.`)
    : check("quantity", "fail", `the quantity is ${q}, but you asked for ${rule}.`);
}

function checkUnexpectedAddOns(checkout: CheckoutSnapshot): CheckoutCheck {
  const unexpected = checkout.addOns.filter((a) => !a.explicitlyAccepted);
  if (unexpected.length === 0) {
    return checkout.addOns.length === 0
      ? check("unexpected_addons", "pass", "there are no extras in the cart.")
      : check("unexpected_addons", "pass", "every extra in the cart was accepted by you.");
  }
  const list = unexpected.map((a) => `${a.label} (${formatCents(a.priceCents)})`).join(", ");
  return check("unexpected_addons", "fail", `extras you did not accept were added: ${list}.`);
}

function checkSubscription(checkout: CheckoutSnapshot): CheckoutCheck {
  if (checkout.hasSubscription === null) {
    return check("subscription", "unknown", "it is unknown whether this checkout includes a subscription.");
  }
  // no shared field records subscription acceptance, so a subscription always blocks
  return checkout.hasSubscription
    ? check("subscription", "fail", "this checkout includes a subscription.")
    : check("subscription", "pass", "there is no subscription.");
}

function checkDelivery(preferences: ShoppingPreferences, checkout: CheckoutSnapshot): CheckoutCheck {
  const req = findRequirement(preferences, DELIVERY_BY_DATE_ATTRIBUTE);
  const date = checkout.estimatedDeliveryDate;
  if (!req) {
    return check(
      "delivery",
      "pass",
      date === null ? "you did not set a delivery deadline." : `you did not set a delivery deadline; estimated delivery is ${date}.`,
    );
  }
  if (req.operator !== "at_most" || !isIsoDate(req.value)) {
    return check("delivery", "unknown", "your delivery deadline could not be read, so delivery cannot be confirmed.");
  }
  const deadline = req.value;
  if (date === null) {
    return check("delivery", "unknown", `the delivery date is not shown, so delivery by ${deadline} cannot be confirmed.`);
  }
  // iso dates compare correctly as strings
  return date <= deadline
    ? check("delivery", "pass", `estimated delivery on ${date} meets your ${deadline} deadline.`)
    : check("delivery", "fail", `estimated delivery on ${date} is after your ${deadline} deadline.`);
}

// every charge must be itemized and known; reads the breakdown back to the shopper
function checkPriceBreakdown(checkout: CheckoutSnapshot): CheckoutCheck {
  const parts = [
    `item ${formatCents(checkout.unitPriceCents)} times ${checkout.quantity} is ${formatCents(itemCents(checkout))}`,
    `extras ${formatCents(addOnCents(checkout))}`,
    `shipping ${checkout.shippingCents === null ? "not shown" : formatCents(checkout.shippingCents)}`,
    `tax ${checkout.taxCents === null ? "not shown" : formatCents(checkout.taxCents)}`,
  ].join(", ");
  return checkout.shippingCents === null || checkout.taxCents === null
    ? check("price_breakdown", "unknown", `the price breakdown is incomplete: ${parts}.`)
    : check("price_breakdown", "pass", `price breakdown: ${parts}.`);
}

function overallFrom(checks: CheckoutCheck[]): CheckoutReview["overall"] {
  if (checks.some((c) => c.status === "fail")) return "blocked";
  // every rule is critical: an unknown never passes
  if (checks.some((c) => c.status === "unknown")) return "needs_review";
  return "pass";
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function spokenSummaryFrom(
  overall: CheckoutReview["overall"],
  totalCents: number | null,
  checkout: CheckoutSnapshot,
  checks: CheckoutCheck[],
): string {
  const head =
    overall === "pass" ? "Checkout review passed." : overall === "blocked" ? "Checkout is blocked." : "Checkout needs review.";
  const parts = [
    head,
    totalCents === null ? "The final total is unknown." : `The final total is ${formatCents(totalCents)}.`,
    // quantity is always disclosed, even when no quantity was requested
    `Quantity: ${checkout.quantity}.`,
  ];
  const failed = checks.filter((c) => c.status === "fail").map((c) => sentence(c.explanation));
  const unknown = checks.filter((c) => c.status === "unknown").map((c) => sentence(c.explanation));
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
    checkTotalBudget(preferences, checkout, totalCents),
    checkItemMatch(checkout, selectedListingId),
    checkQuantity(preferences, checkout),
    checkUnexpectedAddOns(checkout),
    checkSubscription(checkout),
    checkDelivery(preferences, checkout),
    checkPriceBreakdown(checkout),
  ];
  const overall = overallFrom(checks);
  return {
    checkoutId: checkout.id,
    checkoutVersion: checkout.version,
    totalCents,
    checks,
    overall,
    spokenSummary: spokenSummaryFrom(overall, totalCents, checkout, checks),
  };
}
