import { assertSameOrigin, createSttAccessToken, errorResponse } from "@/features/voice/cartesiaServer";

// issues a 60-second, stt-only cartesia access token for the browser websocket
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { token, expiresAt } = await createSttAccessToken();
    return Response.json({ token, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
