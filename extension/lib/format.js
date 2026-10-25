// display wording for the shared tellr types. no checkout math lives here.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents) {
  return usd.format(cents / 100);
}

// typed dollars like "15", "15.5" or "$1,299.00" to integer cents without floating point
export function parseDollarsToCents(text) {
  const match = String(text).trim().replace(/,/g, "").match(/^\$?\s*(\d{1,7})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const EVIDENCE_STATUS = {
  supported: { icon: "✓", label: "Supported by evidence", tone: "good" },
  seller_claimed: { icon: "?", label: "Seller claims it, not verified", tone: "warn" },
  contradicted: { icon: "✕", label: "Contradicted by evidence", tone: "bad" },
  unknown: { icon: "?", label: "Unknown: not enough evidence", tone: "warn" },
};

export const CHECK_STATUS = {
  pass: { icon: "✓", label: "Pass", tone: "good" },
  fail: { icon: "✕", label: "Problem", tone: "bad" },
  unknown: { icon: "?", label: "Unknown", tone: "warn" },
};

export const OVERALL = {
  pass: { icon: "✓", label: "Passed review. You can place a demo order.", tone: "good" },
  blocked: { icon: "✕", label: "Blocked. Fix the problems below first.", tone: "bad" },
  needs_review: { icon: "?", label: "Needs review. Some important details are unknown.", tone: "warn" },
};

const RULE_LABEL = {
  total_budget: "Total within budget",
  item_match: "Same item you inspected",
  quantity: "Quantity",
  unexpected_addons: "Add-ons you did not ask for",
  subscription: "Subscription",
  delivery: "Delivery date",
  price_breakdown: "Price breakdown",
  seller_condition: "Item condition",
};

const ATTRIBUTE_LABEL = {
  screen_condition: "Screen condition",
  charger_included: "Charger included",
  cosmetic_scratches: "Cosmetic scratches",
  delivery_by_date: "Delivered by",
  quantity: "Quantity",
  color: "Color",
  no_unrequested_addons: "No add-ons I did not ask for",
  no_subscription: "No subscription",
};

function humanize(value) {
  const text = String(value).replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ruleLabel(ruleId) {
  return RULE_LABEL[ruleId] ?? humanize(ruleId);
}

function valueText(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value).replace(/_/g, " ");
}

export function describeRequirement(requirement) {
  const label = ATTRIBUTE_LABEL[requirement.attribute] ?? humanize(requirement.attribute);
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

export function budgetText(preferences) {
  return preferences.maxTotalCents === null ? "No budget given" : `Up to ${formatUsd(preferences.maxTotalCents)} total`;
}

export function preferencesSpeech(preferences, questions) {
  const parts = [`Got it. Looking for ${preferences.category || "something"}, ${budgetText(preferences).toLowerCase()}.`];
  for (const requirement of preferences.requirements) {
    parts.push(`${describeRequirement(requirement)}${requirement.priority === "required" ? ", required" : ""}.`);
  }
  if (questions.length) parts.push(questions.join(" "));
  return parts.join(" ");
}

export function clipForSpeech(text, max = 1400) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest is in the side panel.`;
}

export function inspectionSpeech(report) {
  const parts = ["I looked at the listing photos and description."];
  for (const assessment of report.assessments ?? []) {
    const status = EVIDENCE_STATUS[assessment.status];
    parts.push(`${status ? status.label : assessment.status}. ${assessment.explanation}`);
  }
  if (report.sellerQuestions?.length) {
    parts.push(`Questions for the seller: ${report.sellerQuestions.join(" ")}`);
  }
  return parts.join(" ");
}
