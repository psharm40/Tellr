# Cartesia voice (Developer 2)

Push-to-talk speech input with **Cartesia Ink** and spoken responses with **Cartesia Sonic**.
Owns `src/features/voice/**` and `src/app/api/voice/**`. Typing always works without this module.

## Setup
1. Create a key at [play.cartesia.ai/keys](https://play.cartesia.ai/keys). Copy `env.example` to `.env.local` and set
   `CARTESIA_API_KEY` (server only; never `NEXT_PUBLIC_`).
2. `npm run dev`, open the app, press **Start listening** (the browser asks for mic permission on first use).
3. Tests (no dependencies, Node 22.6+): `node --test 'src/features/voice/__tests__/*.test.mjs'`

## Integration (Developer 1)
```tsx
import { VoiceAssistant, type SpeechRequest } from "@/features/voice/VoiceAssistant";

const [speechRequest, setSpeechRequest] = useState<SpeechRequest | null>(null);

<VoiceAssistant
  onTranscript={(text) => handleRequirementsText(text)} // same handler as the typed form
  speechRequest={speechRequest}
  disabled={isSubmitting}
/>

// to speak a result, always pass a fresh id (same text twice still plays twice)
setSpeechRequest({ id: crypto.randomUUID(), text: review.spokenSummary });
```
- `onTranscript` fires exactly once per final utterance; partial text is only shown inside the component.
- The component never calls requirements, inspection, or checkout routes and never touches the cart.
- `disabled` cancels an in-flight recording without emitting a transcript.
- Money in spoken text must come from code. Use `formatCentsForSpeech(cents)` from `speechText.ts`
  (e.g. `3499` → "thirty-four dollars and ninety-nine cents"); Sonic never computes totals.

## Cartesia features used
| Feature | Where | Details |
|---|---|---|
| Ink realtime STT (`ink-2`) | browser → `wss://api.cartesia.ai/stt/websocket` | 16 kHz `pcm_s16le`, manual finalize on Stop: send `"finalize"`, join `is_final` deltas, wait for `flush_done`, send `"close"` |
| Access tokens | `POST /api/voice/token` → `POST /access-token` | `grants: { stt: true }`, 60 s lifetime. The permanent key never leaves the server |
| Sonic TTS (`sonic-3.6`) | `POST /api/voice/speak` → `POST /tts/bytes` | mp3, 44.1 kHz, 128 kbps; voice `a0e99841-438c-4a64-b679-ae501e7d6091` from the Cal Hacks starter pack |

All calls pin `Cartesia-Version: 2026-08-14` and use `https://api.cartesia.ai`, per the
[Cal Hacks starter pack](https://docs.cartesia.ai/calhacks) integration rules.

Why not the other Cartesia options:
- **Managed Agents**: it runs its own LLM conversation loop. Tellr's architecture keeps requirement parsing in Claude
  and checkout decisions in deterministic code, and this component must never act on its own, so we use the STT/TTS
  APIs directly.
- **TTS websocket**: built for text streaming in from an LLM. Our spoken text is complete before playback, so
  `/tts/bytes` is simpler.
- **Official JS SDK**: `package.json` is a frozen shared file, so we call the documented HTTP/WebSocket APIs directly.

## Routes (proposed addition to `docs/API_CONTRACTS.md`; lead to merge)
| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /api/voice/token` | `{}` | `{ token: string, expiresAt: string }` (STT-only, ~60 s) | `{ error }` 403 cross-origin, 502/503/504 upstream or missing key |
| `POST /api/voice/speak` | `{ text: string }` (1–1500 chars after trim) | `200`, `Content-Type: audio/mpeg`, mp3 body | `{ error }` 400 bad body, 413 too long, 403, 502/503/504 |

Manual check: `curl -X POST localhost:3000/api/voice/speak -H 'Content-Type: application/json' -d '{"text":"The total is two hundred sixty-five dollars."}' -o out.mp3`

## Accessibility
- Mic is only on between **Start listening** and **Stop listening** (auto-stops after 30 s). Nothing records on page load.
- **Stop speaking** stops playback immediately. Starting to listen also stops playback, so the mic never records Sonic.
- **Read responses aloud automatically** (on by default, remembered per browser): turn it off for screen readers; the
  response text is then announced via `aria-live` and **Play spoken response** reads it on request.
- Every control is a labelled button or checkbox with visible focus; status, errors, and transcripts are shown as text.
- If the browser blocks autoplay, the audio stays loaded and **Play spoken response** starts it.

## Known limitations
- Push-to-talk only: no barge-in or continuous conversation.
- TTS waits for the full mp3 before playing (short responses, so ~1 s); streaming playback isn't implemented.
- The token route is open to anyone who can reach the deployment. It rejects cross-origin browser requests,
  but that is not real auth. Tokens are short-lived and STT-only. Add rate limiting before any public launch.

## Real test results (2026-10-24, local dev, live Cartesia API)
| Check | Result |
|---|---|
| `POST /api/voice/token` | 200 in 0.87 s; returns a 260-char access token, not the API key |
| `POST /api/voice/speak` (91 chars incl. a price) | 200 in 1.02 s; `audio/mpeg`, 84 KB mp3, 128 kbps, 44.1 kHz mono |
| Speak with blank text / foreign `Origin` | 400 / 403 with plain-language `{ error }` |
| STT websocket with the browser token flow, 5.4 s of Sonic-generated 16 kHz speech streamed in real time | Transcript exact: "I need a used laptop under three hundred dollars, no cracked screen, and a charger." `flush_done` 211 ms after `finalize` |

Manual browser test (Chrome, macOS, real microphone, live API), all passed:
1. Spoken utterance transcribed and shown; `onTranscript` called exactly once; mic released on Stop.
2. New `speechRequest` is spoken aloud by Sonic and shown as text.
3. Same text with a new id speaks again.
4. Code-formatted price ("two hundred sixty-five dollars") pronounced clearly.
5. Stop speaking cuts playback immediately.
6. Auto-read off: nothing plays; Play spoken response reads on request.
7. Disabling mid-recording stops capture without emitting a transcript.
8. Mic blocked in site settings shows a plain-language error with the typed-input fallback.
9. macOS VoiceOver, keyboard only: the blocked-mic error is read aloud automatically when Start listening is pressed.
