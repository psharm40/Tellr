// POST /api/inspection — inspects a listing's real photos and seller description
// and returns an evidence-based InspectionReport. request shape is validated here
// before the model is called. responses follow the frozen contract exactly:
// { report } on success, { error } with a non-2xx status on failure.

import { inspectListing } from "@/features/inspection/inspectListing";
import { InspectionError } from "@/features/inspection/inspectionErrors";

// plain-language error body matching the frozen { error: string } shape, using the
// web-standard Response (supported by next app router; no next runtime coupling).
function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // 1. body must be valid json.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("request body must be valid json.", 400);
  }

  // 2. body must be a json object carrying "listing" and "preferences". deep shape
  //    validation happens inside inspectListing via the frozen zod schemas.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(
      'request body must be a json object with "listing" and "preferences" fields.',
      400,
    );
  }
  const { listing, preferences } = body as { listing?: unknown; preferences?: unknown };
  if (typeof listing !== "object" || listing === null) {
    return errorResponse('"listing" is required.', 400);
  }
  if (typeof preferences !== "object" || preferences === null) {
    return errorResponse('"preferences" is required.', 400);
  }

  // 3. inspect. deep validation (and image checks) occur inside and may throw.
  try {
    // casts are safe: inspectListing re-validates both against the frozen schemas
    // and throws InspectionError("invalid_request") if they do not conform.
    const report = await inspectListing(
      listing as Parameters<typeof inspectListing>[0],
      preferences as Parameters<typeof inspectListing>[1],
    );
    return Response.json({ report }, { status: 200 });
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
    // unexpected failures (including missing api configuration) must not leak
    // internal details. nothing is logged here.
    return errorResponse("an unexpected error occurred. please try again.", 500);
  }
}
