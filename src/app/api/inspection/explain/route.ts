// POST /api/inspection/explain — grounded conversational Q&A about the current
// listing. given the inspection report, the shopper's preferences, a free-form
// question, and optional prior turns, it returns a short, friendly, spoken-friendly
// answer grounded in the inspection findings.
//
// PENDING INTEGRATION APPROVAL: this endpoint is NOT yet in docs/API_CONTRACTS.md.
// the request/response shape below is proposed and must be approved by the team lead
// before it is treated as frozen. implemented entirely within Developer 3's owned
// paths; no shared contracts were modified.
//
// proposed contract:
//   POST /api/inspection/explain
//   request:  { report: InspectionReport, preferences: ShoppingPreferences,
//               question: string, listing?: Listing,
//               history?: { role: "user" | "assistant", text: string }[] }
//   response: { answer: string }  (200)  |  { error: string }  (non-2xx)

import { explainListing } from "@/features/inspection/explainListing";
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
    return errorResponse(
      'request body must be a json object with "report", "preferences", and "question".',
      400,
    );
  }
  const { question } = body as { question?: unknown };
  if (typeof question !== "string" || question.trim().length === 0) {
    return errorResponse('"question" is required and must be a non-empty string.', 400);
  }

  try {
    // deep validation (report, preferences, question length, optional history) happens
    // inside explainListing and throws InspectionError("invalid_request") if invalid.
    const result = await explainListing(body as Parameters<typeof explainListing>[0]);
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
