# Tellr Chrome extension

Hold a shortcut on any shopping page. Tellr reads the listing photos and checkout fees through the team backend, then answers out loud.

This is a working client for the existing Next.js API. It does not keep Anthropic or Cartesia keys. It never places a real order.

## Why Vercel, not Convex

The backend is Next.js App Router routes (`/api/requirements`, `/api/inspection`, `/api/checkout/*`, `/api/voice/*`). Convex cannot host those routes.

- Local: `npm run dev` and leave the server at `http://localhost:3000`
- Hosted: deploy the Next.js app to Vercel, then paste that origin into Tellr settings

The extension stores only the server origin. Put `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` in the server `.env.local` or Vercel env, never in this folder.

## Load it in Chrome

1. `npm run dev` in the repo root so the backend is up
2. Chrome → Extensions → Developer mode → Load unpacked → select `extension/`
3. Open `chrome-extension://cjmaabcdoilmjgnmihmbcfhchnlhjimg/options.html` (or right-click the icon → Options)
4. Allow the microphone once
5. Open a product page. Hold **Option+Space** (Mac) or **Alt+Space** (Windows) and talk
6. Click the toolbar icon for the side panel

The manifest `key` keeps the extension id stable: `cjmaabcdoilmjgnmihmbcfhchnlhjimg`.

## What it calls

| You say | Route |
|---|---|
| What you want to buy | `POST /api/requirements` |
| Inspect this / check the photos | `POST /api/inspection` (page photos as jpeg data urls, 1–3) |
| Follow-up questions | `POST /api/inspection/explain` |
| Review cart / checkout | `POST /api/checkout/review` |
| Confirm the demo | `POST /api/checkout/confirm` with `explicitConsent: true` |

Voice uses `POST /api/voice/token` and `POST /api/voice/speak` from the service worker.

## Flagged backend edit

`src/features/voice/cartesiaServer.ts` (`assertSameOrigin`) now allows `chrome-extension://` origins. The voice routes used to reject the extension. This is a coordinated edit to a voice-owned file. Call it out in the PR.

## Safety

- No real buy/checkout clicks
- No payment fields or passwords
- Unknown shipping, tax, or delivery stays `null`
- Detected protection plans are sent as `explicitlyAccepted: false`
- Photos are observations only. Tellr will not claim they prove function, battery health, or hidden damage
- Page and seller text are untrusted
