# Shared API contracts — freeze before parallel work

All requests/responses use camelCase JSON with the canonical TypeScript types from `src/types/tellr.ts`.
Every server route must validate input and return `{ error: string }` with a non-2xx status on failure.

| Route | Method | Input | Output | Owner |
|---|---|---|---|---|
| `/api/requirements` | POST | `{ text: string }` | `{ preferences: ShoppingPreferences, clarificationQuestions: string[] }` | Inspection |
| `/api/inspection` | POST | `{ listing: Listing, preferences: ShoppingPreferences }` | `{ report: InspectionReport }` | Inspection |
| `/api/voice/token` | POST | `{}` | `{ token: string, expiresAt?: string }` *only if short-lived browser tokens are supported/configured* | Voice |
| `/api/voice/speak` | POST | `{ text: string }` | Audio stream or JSON; voice owner documents final format before integration | Voice |
| `/api/checkout/review` | POST | `{ preferences: ShoppingPreferences, checkout: CheckoutSnapshot }` | `{ review: CheckoutReview }` | Checkout |
| `/api/checkout/confirm` | POST | `{ preferences: ShoppingPreferences, checkout: CheckoutSnapshot, reviewedVersion: number, explicitConsent: true }` | `{ demoOrderId: string, status: "demo_completed" }` | Checkout |

Notes:
- Do not build backend routes by copying arbitrary results from the LLM into checkout fields.
- Product images for local demo can be provided as base64 data URLs in `ListingImage.url` after file type and size validation. Do not depend on CORS access to third-party image URLs. Prefer server-side authenticated storage only if needed.
- `InspectionReport.assessments` must cover relevant requirements and refer to `Evidence.id` in `evidenceIds`.
- `CheckoutSnapshot.version` increases whenever total, delivery, quantity, add-ons, product, or subscription settings change.
- Missing `shippingCents`, `taxCents`, or other required data is `unknown`; total becomes `null` until known. No silent estimation.
- The backend must recompute the review on confirmation. For production, an authoritative server-held session and checkout version would be required to prevent client-controlled state; this hackathon API only records a simulated order.
- `confirm` MUST NOT trigger any external purchase.
- Changing these request/response shapes requires coordinated approval.
