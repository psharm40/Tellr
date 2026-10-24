// runtime validation for checkout request bodies. types alone do not protect a server route.
import type {
  CheckoutAddOn,
  CheckoutSnapshot,
  ShoppingPreferences,
  ShoppingRequirement,
} from "@/types/tellr";
import { isIsoDate } from "./evaluateCheckout";
import { isCents } from "./money";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

const OPERATORS = ["equals", "at_most", "at_least", "allowed"];
const PRIORITIES = ["required", "preference"];

function validateRequirement(v: unknown, i: number): string | null {
  const at = `preferences.requirements[${i}]`;
  if (!isObj(v)) return `${at} must be an object`;
  if (!isNonEmptyString(v.id)) return `${at}.id must be a non-empty string`;
  if (!isNonEmptyString(v.attribute)) return `${at}.attribute must be a non-empty string`;
  if (typeof v.operator !== "string" || !OPERATORS.includes(v.operator)) return `${at}.operator is invalid`;
  const t = typeof v.value;
  if (t !== "string" && t !== "boolean" && !(t === "number" && Number.isFinite(v.value))) {
    return `${at}.value must be a string, number or boolean`;
  }
  if (typeof v.priority !== "string" || !PRIORITIES.includes(v.priority)) return `${at}.priority is invalid`;
  return null;
}

export function validatePreferences(v: unknown): Validated<ShoppingPreferences> {
  if (!isObj(v)) return { ok: false, error: "preferences must be an object" };
  if (typeof v.category !== "string") return { ok: false, error: "preferences.category must be a string" };
  if (v.maxTotalCents !== null && !isCents(v.maxTotalCents)) {
    return { ok: false, error: "preferences.maxTotalCents must be a non-negative integer number of cents or null" };
  }
  if (!Array.isArray(v.requirements)) return { ok: false, error: "preferences.requirements must be an array" };
  for (let i = 0; i < v.requirements.length; i++) {
    const err = validateRequirement(v.requirements[i], i);
    if (err) return { ok: false, error: err };
  }
  return {
    ok: true,
    value: {
      category: v.category,
      maxTotalCents: v.maxTotalCents as number | null,
      requirements: v.requirements as ShoppingRequirement[],
    },
  };
}

function validateAddOn(v: unknown, i: number): string | null {
  const at = `checkout.addOns[${i}]`;
  if (!isObj(v)) return `${at} must be an object`;
  if (!isNonEmptyString(v.id)) return `${at}.id must be a non-empty string`;
  if (typeof v.label !== "string") return `${at}.label must be a string`;
  if (!isCents(v.priceCents)) return `${at}.priceCents must be a non-negative integer number of cents`;
  if (typeof v.explicitlyAccepted !== "boolean") return `${at}.explicitlyAccepted must be a boolean`;
  return null;
}

export function validateCheckout(v: unknown): Validated<CheckoutSnapshot> {
  const fail = (error: string): Validated<CheckoutSnapshot> => ({ ok: false, error });
  if (!isObj(v)) return fail("checkout must be an object");
  if (!isNonEmptyString(v.id)) return fail("checkout.id must be a non-empty string");
  if (!isPositiveInt(v.version)) return fail("checkout.version must be a positive integer");
  if (!isNonEmptyString(v.listingId)) return fail("checkout.listingId must be a non-empty string");
  if (v.currency !== "USD") return fail('checkout.currency must be "USD"');
  if (!isPositiveInt(v.quantity)) return fail("checkout.quantity must be a positive integer");
  if (!isCents(v.unitPriceCents)) return fail("checkout.unitPriceCents must be a non-negative integer number of cents");
  if (v.shippingCents !== null && !isCents(v.shippingCents)) {
    return fail("checkout.shippingCents must be a non-negative integer number of cents or null");
  }
  if (v.taxCents !== null && !isCents(v.taxCents)) {
    return fail("checkout.taxCents must be a non-negative integer number of cents or null");
  }
  if (!Array.isArray(v.addOns)) return fail("checkout.addOns must be an array");
  for (let i = 0; i < v.addOns.length; i++) {
    const err = validateAddOn(v.addOns[i], i);
    if (err) return fail(err);
  }
  if (v.hasSubscription !== null && typeof v.hasSubscription !== "boolean") {
    return fail("checkout.hasSubscription must be a boolean or null");
  }
  if (v.estimatedDeliveryDate !== null && !isIsoDate(v.estimatedDeliveryDate)) {
    return fail("checkout.estimatedDeliveryDate must be a YYYY-MM-DD date or null");
  }
  return {
    ok: true,
    value: {
      id: v.id,
      version: v.version,
      listingId: v.listingId,
      currency: "USD",
      quantity: v.quantity,
      unitPriceCents: v.unitPriceCents,
      shippingCents: v.shippingCents as number | null,
      taxCents: v.taxCents as number | null,
      addOns: v.addOns as CheckoutAddOn[],
      hasSubscription: v.hasSubscription as boolean | null,
      estimatedDeliveryDate: v.estimatedDeliveryDate as string | null,
    },
  };
}

// optional: absent, or null as the shared session type stores it, means unknown.
// a present value must be a non-empty string.
export function validateSelectedListingId(v: unknown): Validated<string | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isNonEmptyString(v)) return { ok: false, error: "selectedListingId must be a non-empty string when provided" };
  return { ok: true, value: v };
}

export interface ReviewRequest {
  preferences: ShoppingPreferences;
  checkout: CheckoutSnapshot;
  selectedListingId?: string;
}

export interface ConfirmRequest extends ReviewRequest {
  reviewedVersion: number;
  explicitConsent: true;
}

export function validateReviewRequest(body: unknown): Validated<ReviewRequest> {
  if (!isObj(body)) return { ok: false, error: "request body must be a json object" };
  const preferences = validatePreferences(body.preferences);
  if (!preferences.ok) return preferences;
  const checkout = validateCheckout(body.checkout);
  if (!checkout.ok) return checkout;
  const selected = validateSelectedListingId(body.selectedListingId);
  if (!selected.ok) return selected;
  return {
    ok: true,
    value: { preferences: preferences.value, checkout: checkout.value, selectedListingId: selected.value },
  };
}

export function validateConfirmRequest(body: unknown): Validated<ConfirmRequest> {
  const base = validateReviewRequest(body);
  if (!base.ok) return base;
  const b = body as Obj;
  if (!isPositiveInt(b.reviewedVersion)) return { ok: false, error: "reviewedVersion must be a positive integer" };
  if (b.explicitConsent !== true) return { ok: false, error: "explicitConsent must be true to confirm a demo order" };
  return { ok: true, value: { ...base.value, reviewedVersion: b.reviewedVersion, explicitConsent: true } };
}
