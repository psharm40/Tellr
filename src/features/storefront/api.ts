// calls the frozen api routes owned by the inspection and checkout teams
import type {
  CheckoutReview,
  CheckoutSnapshot,
  InspectionReport,
  Listing,
  ShoppingPreferences,
} from "@/types/tellr";
import { fixtureInspection, fixturePreferences, fixtureReview } from "./fixtures";

export type ResultSource = "api" | "fixture";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown, expectedKey: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Could not reach the Tellr server. Check your connection and try again.", 0);
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    if (typeof data?.error === "string" && data.error) throw new ApiError(data.error, response.status);
    if (response.status === 404) throw new ApiError("This step's server route is not available yet.", 404);
    throw new ApiError(`The server could not finish this step (error ${response.status}).`, response.status);
  }
  if (!data || !(expectedKey in data)) throw new ApiError("The server sent a response Tellr could not read.", response.status);
  return data as T;
}

// with fixtures on, a missing route (404) falls back to labeled fixture data. real errors always surface.
async function withFixture<T>(request: () => Promise<T>, fixture: () => T, useFixtures: boolean) {
  try {
    return { data: await request(), source: "api" as ResultSource };
  } catch (error) {
    if (useFixtures && error instanceof ApiError && error.status === 404) {
      return { data: fixture(), source: "fixture" as ResultSource };
    }
    throw error;
  }
}

export function parseRequirements(text: string, useFixtures: boolean) {
  return withFixture(
    () =>
      post<{ preferences: ShoppingPreferences; clarificationQuestions: string[] }>(
        "/api/requirements",
        { text },
        "preferences",
      ),
    fixturePreferences,
    useFixtures,
  );
}

export function inspectListing(listing: Listing, preferences: ShoppingPreferences, useFixtures: boolean) {
  return withFixture(
    () => post<{ report: InspectionReport }>("/api/inspection", { listing, preferences }, "report"),
    () => fixtureInspection(listing, preferences),
    useFixtures,
  );
}

export function reviewCheckout(
  preferences: ShoppingPreferences,
  checkout: CheckoutSnapshot,
  selectedListingId: string,
  useFixtures: boolean,
) {
  return withFixture(
    () =>
      post<{ review: CheckoutReview }>(
        "/api/checkout/review",
        { preferences, checkout, selectedListingId },
        "review",
      ),
    () => fixtureReview(checkout),
    useFixtures,
  );
}

// no fixture: a demo order id must only ever come from the real checkout route
export function confirmDemoOrder(
  preferences: ShoppingPreferences,
  checkout: CheckoutSnapshot,
  selectedListingId: string,
  reviewedVersion: number,
) {
  return post<{ demoOrderId: string; status: "demo_completed" }>(
    "/api/checkout/confirm",
    { preferences, checkout, selectedListingId, reviewedVersion, explicitConsent: true },
    "demoOrderId",
  );
}
