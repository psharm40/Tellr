// POST /api/inspection/choose — works out which numbered search results a shopper means
// ("the one with the red bow", "the cheaper ones", "those three").
//
// PENDING INTEGRATION APPROVAL: this endpoint is NOT yet in docs/API_CONTRACTS.md. the shape
// below is proposed and must be approved by the team lead before it is treated as frozen.
//
// proposed contract:
//   POST /api/inspection/choose
//   request:  { question: string,
//               items: { number: number, title: string, priceCents: number,
//                        condition?: string, thumbnail?: "data:image/...;base64,..." }[] (1-10),
//               preferences?: ShoppingPreferences }
//   response: { numbers: number[], answer: string }  (200)  |  { error: string }  (non-2xx)

import { chooseItems } from "@/features/inspection/chooseItems";
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
    return errorResponse('request body must be a json object with "question" and "items".', 400);
  }
  try {
    const result = await chooseItems(body as Parameters<typeof chooseItems>[0]);
    return Response.json(result, { status: 200 });
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
