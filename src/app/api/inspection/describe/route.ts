// POST /api/inspection/describe — plain, sensory descriptions of listed search results for a
// shopper who can't see the photos.
//
// PENDING INTEGRATION APPROVAL: this endpoint is NOT yet in docs/API_CONTRACTS.md.
//
// proposed contract:
//   request:  { items: { number, title, priceCents, condition?, thumbnail? }[] (1-10),
//               preferences?: ShoppingPreferences }
//   response: { items: { number: number, description: string }[] }  (200)  |  { error: string }

import { describeItems } from "@/features/inspection/chooseItems";
import { InspectionError } from "@/features/inspection/inspectionErrors";

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("request body must be valid json.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse('request body must be a json object with "items".', 400);
  }
  try {
    return Response.json(await describeItems(body as Parameters<typeof describeItems>[0]), { status: 200 });
  } catch (err) {
    if (err instanceof InspectionError) {
      switch (err.code) {
        case "invalid_request":
        case "invalid_image":
          return errorResponse(err.message, 400);
        case "model_unavailable":
          return errorResponse(err.message, 503);
        case "invalid_model_output":
          return errorResponse(err.message, 502);
      }
    }
    return errorResponse("an unexpected error occurred. please try again.", 500);
  }
}
