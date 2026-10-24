// display and speech wording for shared types. no checkout math lives here.
import type {
  CheckoutCheckStatus,
  CheckoutReview,
  EvidenceStatus,
  ShoppingPreferences,
  ShoppingRequirement,
} from "@/types/tellr";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}

// turns typed dollars like "15", "15.5" or "$1,299.00" into integer cents without floating point
export function parseDollarsToCents(text: string): number | null {
  const match = text.trim().replace(/,/g, "").match(/^\$?\s*(\d{1,7})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const EVIDENCE_STATUS: Record<EvidenceStatus, { icon: string; label: string; tone: string }> = {
  supported: { icon: "✓", label: "Supported by evidence", tone: "good" },
  seller_claimed: { icon: "?", label: "Seller claims it, not verified", tone: "warn" },
  contradicted: { icon: "✕", label: "Contradicted by evidence", tone: "bad" },
  unknown: { icon: "?", label: "Unknown: not enough evidence", tone: "warn" },
};

export const CHECK_STATUS: Record<CheckoutCheckStatus, { icon: string; label: string; tone: string }> = {
  pass: { icon: "✓", label: "Pass", tone: "good" },
  fail: { icon: "✕", label: "Problem", tone: "bad" },
  unknown: { icon: "?", label: "Unknown", tone: "warn" },
};

export const OVERALL: Record<CheckoutReview["overall"], { icon: string; label: string; tone: string }> = {
  pass: { icon: "✓", label: "Passed review. You can confirm the demo order.", tone: "good" },
  blocked: { icon: "✕", label: "Blocked. Fix the problems below before confirming.", tone: "bad" },
  needs_review: { icon: "?", label: "Needs review. Some important details are unknown.", tone: "warn" },
};

const RULE_LABEL: Record<string, string> = {
  total_budget: "Total within budget",
  item_match: "Same item you selected",
  quantity: "Quantity",
  unexpected_addons: "Add-ons you did not ask for",
  subscription: "Subscription",
  delivery: "Delivery date",
  price_breakdown: "Price breakdown",
  seller_condition: "Item condition",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABEL[ruleId] ?? humanize(ruleId);
}

const ATTRIBUTE_LABEL: Record<string, string> = {
  screen_condition: "Screen condition",
  charger_included: "Charger included",
  cosmetic_scratches: "Cosmetic scratches",
  delivery_by_date: "Delivered by",
  quantity: "Quantity",
  color: "Color",
  no_unrequested_addons: "No add-ons I did not ask for",
  no_subscription: "No subscription",
};

function humanize(value: string): string {
  const text = value.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function valueText(value: ShoppingRequirement["value"]): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value).replace(/_/g, " ");
}

export function requirementLabel(requirement: ShoppingRequirement): string {
  return ATTRIBUTE_LABEL[requirement.attribute] ?? humanize(requirement.attribute);
}

export function describeRequirement(requirement: ShoppingRequirement): string {
  const label = requirementLabel(requirement);
  switch (requirement.operator) {
    case "allowed":
      return `${label}: ${requirement.value === false ? "not okay" : "okay"}`;
    case "at_most":
      return `${label}: at most ${valueText(requirement.value)}`;
    case "at_least":
      return `${label}: at least ${valueText(requirement.value)}`;
    default:
      return `${label}: ${valueText(requirement.value)}`;
  }
}

export function priorityLabel(requirement: ShoppingRequirement): string {
  return requirement.priority === "required" ? "Required" : "Nice to have";
}

export function budgetText(preferences: ShoppingPreferences): string {
  return preferences.maxTotalCents === null
    ? "No budget given"
    : `Up to ${formatUsd(preferences.maxTotalCents)} total`;
}

export function preferencesSpeech(preferences: ShoppingPreferences, questions: string[]): string {
  const parts = [`Here is what I understood. Looking for: ${preferences.category || "not stated"}.`];
  parts.push(`Budget: ${budgetText(preferences)}.`);
  for (const requirement of preferences.requirements) {
    parts.push(`${describeRequirement(requirement)}, ${priorityLabel(requirement).toLowerCase()}.`);
  }
  if (questions.length) parts.push(`I have ${questions.length === 1 ? "a question" : "some questions"}: ${questions.join(" ")}`);
  return parts.join(" ");
}

// keeps spoken text inside the voice route's length cap
export function clipForSpeech(text: string, max = 1400): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(". ") + 1 || max)} The rest is on screen.`;
}
