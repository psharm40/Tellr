// post /api/checkout/review: deterministic checkout review. no ai calls.
import { evaluateCheckout } from "@/features/checkout/evaluateCheckout";
import { validateReviewRequest } from "@/features/checkout/validate";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "request body must be valid json" }, { status: 400 });
  }
  const parsed = validateReviewRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { preferences, checkout, selectedListingId } = parsed.value;
  const review = evaluateCheckout(preferences, checkout, selectedListingId);
  return Response.json({ review });
}
