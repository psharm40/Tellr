// server-only factory for the anthropic sdk client used by the inspection and
// requirements routes. the api key is read from the server environment by the
// sdk itself and is never read, logged, or exposed by this module.

import Anthropic from "@anthropic-ai/sdk";

// sensible defaults for short structured-extraction calls. timeout is in
// milliseconds (typescript sdk); maxRetries covers transient 429/5xx/network
// errors via the sdk's built-in exponential backoff.
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

// cached singleton so we don't reconstruct the client on every request within a
// warm serverless instance.
let client: Anthropic | null = null;

// returns a configured anthropic client. constructed lazily (not at import time)
// so a missing key only fails an actual request, not the build. throws if called
// from the browser or if the key is absent, without touching the key's value.
export function getAnthropicClient(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error(
      "the anthropic client is server-only and must not run in the browser.",
    );
  }

  if (client) {
    return client;
  }

  // presence check only — we never read or log the actual value.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured in the server environment.",
    );
  }

  // apiKey is omitted on purpose: the sdk reads ANTHROPIC_API_KEY from the
  // environment, so the secret never passes through our code.
  client = new Anthropic({
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  return client;
}
