// model configuration for the inspection/requirements claude calls.
// the model id is read from the server environment, never hard-coded, so the
// team can swap models without code changes. our configured model is
// claude-haiku-4-5-20251001 (set in .env.local as ANTHROPIC_MODEL).

// returns the configured anthropic model id from the server environment.
// throws a plain-language error if it is missing so routes can surface a clear
// failure instead of silently calling an undefined model.
export function getModel(): string {
  const model = process.env.ANTHROPIC_MODEL?.trim();
  if (!model) {
    throw new Error(
      "ANTHROPIC_MODEL is not configured. set it in .env.local (server environment).",
    );
  }
  return model;
}

// per-model call constraints. claude haiku 4.5 rejects the `effort` parameter
// and we do not need extended thinking for structured extraction, so inspection
// requests omit both. callers should not pass `effort` or `thinking`.
export const MODEL_SUPPORTS_EFFORT = false;
export const MODEL_SUPPORTS_THINKING = false;
