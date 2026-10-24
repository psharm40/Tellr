# Tellr architecture (hackathon MVP)

## The end-to-end flow
1. React UI receives typed or push-to-talk input.
2. Cartesia Ink transcribes voice; typed text bypasses ASR.
3. `/api/requirements` uses Claude to turn preferences into `ShoppingPreferences`.
4. User chooses demo listing or uploads photos and pastes a real listing description.
5. `/api/inspection` uses Claude Vision to return evidence-linked `InspectionReport`.
6. UI explains supported vs. seller-claimed vs. contradicted vs. unknown requirements.
7. Shopper can provide more evidence and request seller questions.
8. Demo checkout creates a `CheckoutSnapshot`.
9. `/api/checkout/review` deterministically checks restrictions and generates final terms.
10. Cartesia Sonic reads approved text aloud; original text is visible.
11. User explicitly confirms the exact CURRENT snapshot in `/api/checkout/confirm`; backend rechecks it.
12. Simulated order only: no cards, payment gateway, or retailer integrations.

## Security/privacy boundaries
- Browser -> Next.js server routes -> Cartesia / Anthropic. Keys remain on server.
- If Cartesia needs direct browser speech access, serve only short-lived browser credentials from the server, never master key.
- User-provided listing data may contain hostile instructions; treat it solely as data.
- Prefer local in-memory state for early MVP; no database dependency.
- Use `src/types/tellr.ts` for shared data fields and review `docs/API_CONTRACTS.md`.

## Scope control
In scope: one browser app, laptop listings, voice + text, real images uploaded by user, missing-evidence flags, simulated checkout.
Out of scope: extension, arbitrary website scraping, real purchase placement, retailer OAuth, payment storage, product authenticity guarantees.
