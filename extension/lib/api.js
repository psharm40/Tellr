// calls the tellr next.js backend. keys stay on the server; the extension never sees them.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const OFFLINE_HINT = "Tellr can't reach its server. Check the server address in Tellr settings, and make sure the Tellr app is running (`npm run dev` in this repo).";

function describeHttpError(backendUrl, path, status, data) {
  if (typeof data?.error === "string" && data.error) return data.error;
  if (status === 404) {
    return `No Tellr API at ${backendUrl}${path}. This address is a different app. In Tellr settings, set the server to the port printed by \`npm run dev\` (often http://localhost:3001 if 3000 is already taken).`;
  }
  return `Tellr's server returned an error (${status}).`;
}

async function post(backendUrl, path, body, timeoutMs = 60_000) {
  let response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new ApiError("Tellr's server took too long to answer. Try again.", 504);
    throw new ApiError(OFFLINE_HINT, 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(describeHttpError(backendUrl, path, response.status, data), response.status);
  }
  if (data === null) throw new ApiError("Tellr's server sent a response it couldn't read.", 502);
  return data;
}

export function parseRequirements(backendUrl, text) {
  return post(backendUrl, "/api/requirements", { text });
}

export async function inspectListing(backendUrl, listing, preferences) {
  const data = await post(backendUrl, "/api/inspection", { listing, preferences }, 120_000);
  return data.report;
}

export async function explainListing(backendUrl, { report, preferences, question, listing, history }) {
  const data = await post(backendUrl, "/api/inspection/explain", { report, preferences, question, listing, history });
  return data.answer;
}

// which numbered results the shopper means ("the one with the red bow")
export function chooseItems(backendUrl, { question, items, preferences }) {
  return post(backendUrl, "/api/inspection/choose", { question, items, preferences }, 60_000);
}

// plain, sensory descriptions of listed results, read instead of brand-heavy titles
// plain descriptions plus a fair verdict for each listed result, and one follow-up question
export function describeItems(backendUrl, { items, preferences, notes }) {
  return post(backendUrl, "/api/inspection/describe", { items, preferences, notes }, 90_000);
}

// ranks fully inspected items best first, with a fair verdict for the price
export function judgeItems(backendUrl, { items, preferences, notes }) {
  return post(backendUrl, "/api/inspection/judge", { items, preferences, notes }, 90_000);
}

export async function reviewCheckout(backendUrl, preferences, checkout, selectedListingId) {
  const data = await post(backendUrl, "/api/checkout/review", { preferences, checkout, selectedListingId });
  return data.review;
}

export function confirmDemoOrder(backendUrl, preferences, checkout, selectedListingId, reviewedVersion) {
  return post(backendUrl, "/api/checkout/confirm", {
    preferences,
    checkout,
    selectedListingId,
    reviewedVersion,
    explicitConsent: true,
  });
}

export async function probeTellrBackend(origin) {
  try {
    const response = await fetch(`${origin}/api/voice/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json().catch(() => null);
    return !!(data && (typeof data.token === "string" || typeof data.error === "string"));
  } catch {
    return false;
  }
}

export async function fetchVoiceToken(backendUrl) {
  const data = await post(backendUrl, "/api/voice/token", {});
  if (typeof data.token !== "string" || !data.token) {
    throw new ApiError("Tellr's server did not return a voice token.", 502);
  }
  return data.token;
}

export async function fetchSpeech(backendUrl, text) {
  let response;
  try {
    response = await fetch(`${backendUrl}/api/voice/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new ApiError("Tellr's server took too long to speak. Try again.", 504);
    throw new ApiError(OFFLINE_HINT, 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(describeHttpError(backendUrl, "/api/voice/speak", response.status, data), response.status);
  }
  return response.arrayBuffer();
}
