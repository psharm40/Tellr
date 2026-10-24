import {
  VoiceServiceError,
  assertSameOrigin,
  errorResponse,
  parseSpeakBody,
  synthesizeSpeech,
} from "@/features/voice/cartesiaServer";

// turns { text } into mp3 audio (audio/mpeg) using cartesia sonic
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new VoiceServiceError('Send JSON like { "text": "..." }.', 400);
    }
    const audio = await synthesizeSpeech(parseSpeakBody(body));
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
