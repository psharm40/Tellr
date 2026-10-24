// the page's single shopping session. any change to an input clears the results that depended on it.
import type {
  CheckoutReview,
  CheckoutSnapshot,
  InspectionReport,
  Listing,
  ShoppingPreferences,
  ShoppingSession,
  ShoppingSessionStatus,
} from "@/types/tellr";
import type { ResultSource } from "./api";
import { DEMO_LISTINGS, initialCheckout } from "./demoListings";

export interface AppState {
  session: ShoppingSession;
  listings: Listing[];
  preferencesReady: boolean;
  preferencesSource: ResultSource | null;
  clarificationQuestions: string[];
  inspectionSource: ResultSource | null;
  reviewSource: ResultSource | null;
  demoOrderId: string | null;
  // bumped whenever an input changes, so late responses for old inputs are dropped
  preferencesRevision: number;
  listingRevision: number;
  photoCounter: number;
  notice: string | null;
}

export type Action =
  | {
      type: "preferences_loaded";
      preferences: ShoppingPreferences;
      clarificationQuestions: string[];
      source: ResultSource;
    }
  | { type: "select_listing"; listingId: string }
  | { type: "add_photos"; listingId: string; urls: string[] }
  | { type: "remove_photo"; listingId: string; imageId: string }
  | { type: "edit_description"; listingId: string; description: string }
  | {
      type: "inspection_loaded";
      report: InspectionReport;
      source: ResultSource;
      preferencesRevision: number;
      listingRevision: number;
    }
  | { type: "edit_checkout"; patch: Partial<Omit<CheckoutSnapshot, "id" | "version" | "listingId" | "currency">> }
  | { type: "review_loaded"; review: CheckoutReview; source: ResultSource; preferencesRevision: number }
  | { type: "order_confirmed"; demoOrderId: string; version: number }
  | { type: "clear_notice" };

const EMPTY_PREFERENCES: ShoppingPreferences = { category: "", maxTotalCents: null, requirements: [] };

export function createInitialState(): AppState {
  const listing = DEMO_LISTINGS[0];
  return {
    session: {
      id: "session_local",
      preferences: EMPTY_PREFERENCES,
      selectedListingId: listing.id,
      inspectionReport: null,
      checkout: initialCheckout(listing, 1),
      checkoutReview: null,
      status: "shopping",
    },
    listings: DEMO_LISTINGS,
    preferencesReady: false,
    preferencesSource: null,
    clarificationQuestions: [],
    inspectionSource: null,
    reviewSource: null,
    demoOrderId: null,
    preferencesRevision: 0,
    listingRevision: 0,
    photoCounter: 0,
    notice: null,
  };
}

export function selectedListing(state: AppState): Listing | null {
  return state.listings.find((listing) => listing.id === state.session.selectedListingId) ?? null;
}

export function reviewIsCurrent(state: AppState): boolean {
  const { checkout, checkoutReview } = state.session;
  return Boolean(checkout && checkoutReview && checkoutReview.checkoutVersion === checkout.version);
}

function deriveStatus(state: AppState): ShoppingSessionStatus {
  if (state.demoOrderId) return "demo_completed";
  if (reviewIsCurrent(state) && state.session.checkoutReview?.overall === "pass") return "awaiting_confirmation";
  if (state.session.inspectionReport || state.session.checkoutReview) return "reviewing";
  if (state.preferencesReady) return "inspecting";
  return "shopping";
}

function withStatus(state: AppState): AppState {
  return { ...state, session: { ...state.session, status: deriveStatus(state) } };
}

// drops inspection, review, and any demo order. used when preferences or the listing change.
function clearResults(state: AppState, reason: string): AppState {
  const hadResults = Boolean(state.session.inspectionReport || state.session.checkoutReview || state.demoOrderId);
  return {
    ...state,
    session: { ...state.session, inspectionReport: null, checkoutReview: null },
    inspectionSource: null,
    reviewSource: null,
    demoOrderId: null,
    notice: hadResults ? reason : state.notice,
  };
}

function updateListing(state: AppState, listingId: string, change: (listing: Listing) => Listing): AppState {
  const next = {
    ...state,
    listings: state.listings.map((listing) => (listing.id === listingId ? change(listing) : listing)),
    listingRevision: state.listingRevision + 1,
  };
  return clearResults(next, "The listing changed, so the earlier inspection and checkout review were cleared.");
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "preferences_loaded": {
      const next = {
        ...state,
        session: { ...state.session, preferences: action.preferences },
        preferencesReady: true,
        preferencesSource: action.source,
        clarificationQuestions: action.clarificationQuestions,
        preferencesRevision: state.preferencesRevision + 1,
      };
      return clearResults(next, "Your requirements changed, so the earlier inspection and checkout review were cleared.");
    }
    case "select_listing": {
      const listing = state.listings.find((item) => item.id === action.listingId);
      if (!listing || listing.id === state.session.selectedListingId) return state;
      const version = (state.session.checkout?.version ?? 0) + 1;
      const next = {
        ...state,
        session: { ...state.session, selectedListingId: listing.id, checkout: initialCheckout(listing, version) },
        listingRevision: state.listingRevision + 1,
      };
      return clearResults(next, "You chose a different listing, so the earlier inspection and checkout review were cleared.");
    }
    case "add_photos": {
      let counter = state.photoCounter;
      const added = action.urls.map((url) => {
        counter += 1;
        return { id: `photo-${counter}`, url, alt: `Seller photo ${counter}; condition unverified` };
      });
      const next = updateListing(state, action.listingId, (listing) => ({
        ...listing,
        images: [...listing.images, ...added],
      }));
      return { ...next, photoCounter: counter };
    }
    case "remove_photo":
      return updateListing(state, action.listingId, (listing) => ({
        ...listing,
        images: listing.images.filter((image) => image.id !== action.imageId),
      }));
    case "edit_description":
      return updateListing(state, action.listingId, (listing) => ({ ...listing, description: action.description }));
    case "inspection_loaded":
      if (
        action.preferencesRevision !== state.preferencesRevision ||
        action.listingRevision !== state.listingRevision ||
        action.report.listingId !== state.session.selectedListingId
      ) {
        return state;
      }
      return {
        ...state,
        session: { ...state.session, inspectionReport: action.report },
        inspectionSource: action.source,
        notice: null,
      };
    case "edit_checkout": {
      const checkout = state.session.checkout;
      if (!checkout) return state;
      const hadOrder = Boolean(state.demoOrderId);
      const hadReview = Boolean(state.session.checkoutReview);
      return {
        ...state,
        session: {
          ...state.session,
          checkout: { ...checkout, ...action.patch, version: checkout.version + 1 },
          checkoutReview: null,
        },
        reviewSource: null,
        demoOrderId: null,
        notice: hadOrder
          ? "The checkout changed after your demo order, so that confirmation no longer applies. Review it again."
          : hadReview
            ? "The checkout changed, so it needs a new review."
            : state.notice,
      };
    }
    case "review_loaded": {
      const checkout = state.session.checkout;
      if (
        !checkout ||
        action.preferencesRevision !== state.preferencesRevision ||
        action.review.checkoutVersion !== checkout.version ||
        action.review.checkoutId !== checkout.id
      ) {
        return state;
      }
      return {
        ...state,
        session: { ...state.session, checkoutReview: action.review },
        reviewSource: action.source,
        notice: null,
      };
    }
    case "order_confirmed":
      if (state.session.checkout?.version !== action.version) return state;
      return { ...state, demoOrderId: action.demoOrderId, notice: null };
    case "clear_notice":
      return { ...state, notice: null };
  }
}

export function sessionReducer(state: AppState, action: Action): AppState {
  return withStatus(reduce(state, action));
}
