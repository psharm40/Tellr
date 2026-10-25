// server-only cartesia helpers. never import this from a client component:
// it reads CARTESIA_API_KEY from the server environment.

import { CARTESIA_VERSION } from "./cartesiaStt";

const API_BASE = "https://api.cartesia.ai";
export const TTS_MODEL_ID = "sonic-3.6";
// voice used in cartesia's cal hacks 13.0 starter pack (docs.cartesia.ai/calhacks)
const VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091";
export const MAX_SPEAK_CHARS = 1500;
export const TOKEN_TTL_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 15_000;

export class VoiceServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function apiKey(): string {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) {
    throw new VoiceServiceError("Voice is not configured on this server. Typed input still works.", 503);
  }
  return key;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Cartesia-Version": CARTESIA_VERSION,
    ...extra,
  };
}

// map upstream status codes to plain-language errors without leaking upstream bodies
function upstreamError(status: number, what: string): VoiceServiceError {
  if (status === 401 || status === 403) {
    return new VoiceServiceError(`Cartesia rejected the server's credentials for ${what}.`, 502);
  }
  if (status === 429) {
    return new VoiceServiceError(`Cartesia is rate limiting ${what} right now. Please try again shortly.`, 503);
  }
  return new VoiceServiceError(`Cartesia couldn't complete ${what} (status ${status}).`, 502);
}

async function cartesiaFetch(path: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    throw new VoiceServiceError(`Couldn't reach Cartesia for ${what}.`, 504);
  }
  if (!res.ok) throw upstreamError(res.status, what);
  return res;
}

// short-lived token that only grants speech-to-text; the permanent key stays here
export async function createSttAccessToken(): Promise<{ token: string; expiresAt: string }> {
  const res = await cartesiaFetch(
    "/access-token",
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ grants: { stt: true }, expires_in: TOKEN_TTL_SECONDS }),
    },
    "a voice session token",
  );
  const body: unknown = await res.json().catch(() => null);
  const token = body && typeof body === "object" && "token" in body ? body.token : null;
  if (typeof token !== "string" || !token) {
    throw new VoiceServiceError("Cartesia returned an unexpected token response.", 502);
  }
  return { token, expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString() };
}

// returns mp3 audio from sonic for already-formatted text. no arithmetic or judgment happens here.
export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const res = await cartesiaFetch(
    "/tts/bytes",
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model_id: TTS_MODEL_ID,
        transcript: text,
        voice: { id: VOICE_ID },
        language: "en",
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
    },
    "speech",
  );
  return res.arrayBuffer();
}

// validates { text } bodies for /api/voice/speak
export function parseSpeakBody(body: unknown): string {
  const text = body && typeof body === "object" && "text" in body ? body.text : undefined;
  if (typeof text !== "string") {
    throw new VoiceServiceError('Send JSON like { "text": "..." }.', 400);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new VoiceServiceError("There is no text to speak.", 400);
  if (trimmed.length > MAX_SPEAK_CHARS) {
    throw new VoiceServiceError(`Text to speak must be ${MAX_SPEAK_CHARS} characters or fewer.`, 413);
  }
  return trimmed;
}

// blocks cross-site pages from spending our cartesia quota through these routes.
// not real auth: anyone can still call the routes directly. fine for a demo, noted in the readme.
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    // malformed origin falls through to rejection
  }
  throw new VoiceServiceError("Voice requests must come from the Tellr app.", 403);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof VoiceServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json({ error: "Something went wrong with voice. Typed input still works." }, { status: 500 });
}
