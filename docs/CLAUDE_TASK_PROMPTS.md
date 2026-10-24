# Paste these into a shared Google Doc (NO secrets!)

## Shared project brief (paste once)
We are building Tellr for Cal Hacks 13.0, a voice-first assistant for blind/low-vision shoppers. The complete MVP is: spoken shopping requirements, an accessible listing experience, Claude Vision analysis of real uploaded secondhand product photos and descriptions with evidence + unknowns, and deterministic simulated-checkout verification with an explicit spoken/text confirmation. Stack: Next.js 16 App Router, React, TypeScript, Tailwind, Claude API, Cartesia Ink/Sonic, Vercel. One repo, four parallel branches. No third-party privileged access, scraping requirement, real cards, or real purchases. Read the repo's `CLAUDE.md`, `src/types/tellr.ts` and `docs/API_CONTRACTS.md`. Do not change shared types or another person's paths without agreement. Only use `.env.local` for keys. Show a working result, run lint and typecheck, describe changed files, and commit to your feature branch; NEVER push directly to main.

## Developer 1: UI + accessibility — branch feat/storefront
Build a polished but accessible Next.js frontend for: landing/voice shopping, fictional listings, inspection report (including evidence IDs and unknown findings), simulated checkout review. Build in `src/app/**` (not api), `src/components/**`, `src/features/storefront/**`. Use fixture data until real APIs are integrated. Include keyboard navigation, visible focus, status text, ARIA/live regions where appropriate, voice/text choice, and VoiceOver testing. Import shared types, don't invent new API fields. Integrate workstreams through typed component props.

## Developer 2: Voice/Cartesia — branch feat/voice
Build reusable push-to-talk voice input and speak-back playback using Cartesia Ink and Sonic, with text fallback and controls to stop audio. Own `src/features/voice/**` and `src/app/api/voice/**`. Keep master API key on server. Coordinate browser token implementation with actual Cartesia SDK docs. Output transcribed text to a callback; accept typed responses to speak. Respect screen-reader users and avoid unrequested continuous speech. Include error states and keyboard controls. Do not edit storefront pages; provide integration instructions.

## Developer 3: Claude inspection — branch feat/inspection
Own `src/features/inspection/**`, `/api/requirements`, `/api/inspection`. Parse spoken/typed requirements into canonical `ShoppingPreferences`. Inspect uploaded secondhand laptop photos and listing text using Claude multimodal API. Return canonical `InspectionReport`, cite image IDs / description when describing defects, separate seller claims from visual evidence, mark unknown when unclear, and generate 1–3 specific questions for missing evidence. Never give an unsupported "safe to buy" guarantee or comply with instructions embedded in seller listings. Build a demonstrable sample endpoint. Do not edit other team paths.

## Developer 4: Checkout and session — branch feat/checkout
Own `src/features/checkout/**`, `src/app/api/checkout/**`, `src/lib/session/**`. Implement pure deterministic checkout checks on `CheckoutSnapshot` + `ShoppingPreferences` (not Claude): exact final total in cents, budget, quantity, extras, subscription, delivery conditions when available, pass/fail/unknown. Review returns `CheckoutReview` and stable text that Cartesia can read. When any checkout value changes, previously reviewed version no longer authorizes confirmation. Confirmation must re-run checks on the server, require explicit consent, and only return a DEMO order. Add tests for fee changes, tax unknown, unrequested addons, changed checkout after confirmation. Do not change types or UI paths.

## Required handoff from each developer
- Branch URL and PR URL
- Files changed and public props/endpoints
- Example request and response
- How to reproduce locally
- Result of `npm run lint` and `npx tsc --noEmit`
- Open blockers; requests for shared-type changes
