// demo confirmation. re-runs every check and never touches a real payment or retailer.
import type { CheckoutReview } from "@/types/tellr";
import { evaluateCheckout } from "./evaluateCheckout";
import type { ConfirmRequest } from "./validate";

export type ConfirmResult =
  | { ok: true; demoOrderId: string; status: "demo_completed"; review: CheckoutReview }
  | { ok: false; httpStatus: 409; error: string; review: CheckoutReview };

export function confirmDemoOrder(
  request: ConfirmRequest,
  makeOrderId: () => string = () => `demo_${crypto.randomUUID()}`,
): ConfirmResult {
  // always recompute on the server; a review sent by the client is never trusted
  const review = evaluateCheckout(request.preferences, request.checkout, request.selectedListingId);

  // any change bumps the version, so an older review no longer authorizes confirmation
  if (request.reviewedVersion !== request.checkout.version) {
    return {
      ok: false,
      httpStatus: 409,
      error: `checkout changed since it was reviewed (reviewed version ${request.reviewedVersion}, current version ${request.checkout.version}). review it again before confirming.`,
      review,
    };
  }
  if (review.overall !== "pass") {
    const reasons = review.checks
      .filter((c) => c.status !== "pass")
      .map((c) => `${c.ruleId}: ${c.status}`)
      .join(", ");
    return {
      ok: false,
      httpStatus: 409,
      error: `checkout cannot be confirmed because it is ${review.overall === "blocked" ? "blocked" : "not fully verified"} (${reasons}).`,
      review,
    };
  }
  return { ok: true, demoOrderId: makeOrderId(), status: "demo_completed", review };
}
