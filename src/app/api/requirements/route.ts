// POST /api/requirements — turns a shopper's natural-language text into canonical
// ShoppingPreferences plus clarification questions. request validation happens
// here before the parser is called, so an invalid request never triggers a model
// call. responses follow the frozen contract exactly: { preferences,
// clarificationQuestions } on success, { error } with a non-2xx status on failure.

import {
  parseRequirements,
  RequirementsParseError,
  MAX_INPUT_CHARS,
} from "@/features/inspection/parseRequirements";

// plain-language error body matching the frozen { error: string } shape. uses the
// web-standard Response (supported by next app router) so the handler has no next
// runtime coupling and stays unit-testable.
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

  // 2. body must be a json object carrying a string "text".
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse('request body must be a json object with a "text" field.', 400);
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return errorResponse('"text" is required and must be a string.', 400);
  }

  // 3. reject empty or excessively long text before any model call.
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return errorResponse("please describe what you are shopping for.", 400);
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return errorResponse(
      `please shorten your request to ${MAX_INPUT_CHARS} characters or fewer.`,
      400,
    );
  }

  // 4. parse. this is the only path that may call the model.
  try {
    const result = await parseRequirements(text);
    return Response.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof RequirementsParseError) {
      switch (err.code) {
        case "empty_input":
        case "input_too_long":
          return errorResponse(err.message, 400);
        case "model_unavailable":
          return errorResponse(err.message, 503);
        case "invalid_model_output":
          return errorResponse(err.message, 502);
      }
    }
    // unexpected failures (including missing api configuration) must not leak
    // internal details or shopper input. nothing is logged here.
    return errorResponse("an unexpected error occurred. please try again.", 500);
  }
}
