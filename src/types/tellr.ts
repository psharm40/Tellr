// shared contracts: coordinate any changes with all four developers

export type EvidenceStatus =
  | "supported"
  | "seller_claimed"
  | "contradicted"
  | "unknown";

export type CheckoutCheckStatus = "pass" | "fail" | "unknown";

export type RequirementValue = string | number | boolean;

export interface ShoppingRequirement {
  id: string;
  attribute: string;
  operator: "equals" | "at_most" | "at_least" | "allowed";
  value: RequirementValue;
  priority: "required" | "preference";
}

export interface ShoppingPreferences {
  category: string;
  maxTotalCents: number | null;
  requirements: ShoppingRequirement[];
}

export interface ListingImage {
  id: string;
  url: string;
  alt: string;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  category: string;
  itemPriceCents: number;
  currency: "USD";
  images: ListingImage[];
}

export interface Evidence {
  id: string;
  sourceType: "photo" | "description" | "seller_response";
  sourceId: string;
  observation: string;
}

export interface RequirementAssessment {
  requirementId: string;
  status: EvidenceStatus;
  explanation: string;
  evidenceIds: string[];
  followUpQuestion?: string;
}

export interface InspectionReport {
  listingId: string;
  evidence: Evidence[];
  assessments: RequirementAssessment[];
  sellerQuestions: string[];
}

export interface CheckoutAddOn {
  id: string;
  label: string;
  priceCents: number;
  explicitlyAccepted: boolean;
}

export interface CheckoutSnapshot {
  id: string;
  version: number;
  listingId: string;
  currency: "USD";
  quantity: number;
  unitPriceCents: number;
  shippingCents: number | null;
  taxCents: number | null;
  addOns: CheckoutAddOn[];
  hasSubscription: boolean | null;
  estimatedDeliveryDate: string | null;
}

export interface CheckoutCheck {
  ruleId: string;
  status: CheckoutCheckStatus;
  explanation: string;
}

export interface CheckoutReview {
  checkoutId: string;
  checkoutVersion: number;
  totalCents: number | null;
  checks: CheckoutCheck[];
  overall: "pass" | "blocked" | "needs_review";
  spokenSummary: string;
}

export type ShoppingSessionStatus =
  | "shopping"
  | "inspecting"
  | "reviewing"
  | "awaiting_confirmation"
  | "demo_completed";

export interface ShoppingSession {
  id: string;
  preferences: ShoppingPreferences;
  selectedListingId: string | null;
  inspectionReport: InspectionReport | null;
  checkout: CheckoutSnapshot | null;
  checkoutReview: CheckoutReview | null;
  status: ShoppingSessionStatus;
}

export type VoiceIntent =
  | "set_requirements"
  | "inspect_listing"
  | "explain_findings"
  | "ask_seller_questions"
  | "review_checkout"
  | "confirm_demo_order"
  | "cancel";
