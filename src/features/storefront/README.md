# Storefront and accessible UI (Developer 1)

One page, four numbered steps: **Tell us what matters → Inspect the used item → Check checkout → Review & confirm demo order**.
`src/app/page.tsx` renders `TellrApp`, which owns the single `ShoppingSession` (`session.ts`, a `useReducer`).

| File | Job |
|---|---|
| `TellrApp.tsx` | page orchestrator: session state, api calls, focus, announcements, speech requests |
| `session.ts` | reducer. any input change clears the results that depended on it |
| `api.ts` | calls the frozen routes; `fixtures.ts` holds the labeled development fixtures |
| `format.ts` | display and speech wording. no checkout math |
| `images.ts` | checks and shrinks uploaded photos into jpeg data urls |
| `demoListings.ts` | two fictional listings and their starting checkout |
| `voice.ts` | the one import of the voice component (stub until `feat/voice` merges) |
| `src/components/*` | `RequirementsForm`, `ListingSelector`, `ListingCard`, `ImageUpload`, `InspectionReportView`, `CheckoutEditor`, `CheckoutReviewView` (+ `DemoConfirmation`), `AccessibleStatus`, `StepSection` |

## Plugging in the real voice component
1. In `voice.ts`, change the import to `@/features/voice/VoiceAssistant`.
2. Delete `VoiceAssistantStub.tsx`.

Nothing else changes. `onTranscript` is `submitRequirements`, the same handler as the typed form, and every spoken result gets
a new `crypto.randomUUID()` id. Tested against `origin/feat/voice`: it type-checks, lints, and renders.

## Development fixtures
Add `?fixtures=1` to the address. Only routes that return 404 (not merged yet) fall back to fixtures, and every fixture result
shows a **DEVELOPMENT FIXTURE** label and says it was not analyzed. Real errors are never replaced with fixtures, and a demo order
ID only ever comes from the real `/api/checkout/confirm`. Without the flag, a missing route shows a plain error and **Try again**.

## Sample API calls the page makes
```sh
curl -X POST localhost:3000/api/requirements -H 'content-type: application/json' \
  -d '{"text":"I need a used laptop under $300, no cracked screen, and a charger."}'

# images[].url is a jpeg data url made in the browser from the shopper's upload
curl -X POST localhost:3000/api/inspection -H 'content-type: application/json' -d '{
  "listing": {"id":"listing_demo_laptop_001","title":"Used 13-inch laptop, silver","description":"Lightly used. Charger included.",
    "category":"laptop","itemPriceCents":25000,"currency":"USD",
    "images":[{"id":"photo-1","url":"data:image/jpeg;base64,...","alt":"Seller photo 1; condition unverified"}]},
  "preferences": {"category":"laptop","maxTotalCents":30000,"requirements":[
    {"id":"req_screen","attribute":"screen_condition","operator":"equals","value":"no_cracks","priority":"required"},
    {"id":"req_charger","attribute":"charger_included","operator":"equals","value":true,"priority":"required"}]}}'

curl -X POST localhost:3000/api/checkout/review -H 'content-type: application/json' -d '{
  "preferences": {"category":"laptop","maxTotalCents":30000,"requirements":[]},
  "checkout": {"id":"checkout_listing_demo_laptop_001","version":2,"listingId":"listing_demo_laptop_001","currency":"USD",
    "quantity":1,"unitPriceCents":25000,"shippingCents":1500,"taxCents":2063,
    "addOns":[{"id":"addon_protection_plan","label":"Protection plan","priceCents":900,"explicitlyAccepted":false}],
    "hasSubscription":false,"estimatedDeliveryDate":"2026-10-30"},
  "selectedListingId": "listing_demo_laptop_001"}'

# same body as review, plus:  "reviewedVersion": 2, "explicitConsent": true
curl -X POST localhost:3000/api/checkout/confirm -H 'content-type: application/json' -d '{ ... }'
```

## 90-second demo script
1. **(0:00)** "Tellr helps blind and low-vision shoppers check a used laptop before buying." Press **Start listening** and say:
   "I need a used laptop under three hundred dollars, no cracked screen, and a charger." Step 1 shows the budget and both
   requirements, and Tellr reads them back.
2. **(0:20)** In step 2, keep the silver laptop. Press **Add photos** and pick one or two photos of a closed laptop with no
   charger in view. Press **Inspect this listing**. Focus jumps to the report: the charger is *seller claimed*, the screen is
   *unknown* because no photo shows it powered on, and each finding names its photo ID. Press **Read report aloud**.
3. **(0:45)** In step 3, press **Review checkout**: it passes at $285.63. Press **Add a $9 protection plan I didn't ask for**,
   then **Review checkout** again: it is **Blocked**, even though $294.63 is under budget, and Tellr reads why.
4. **(1:05)** Press **Remove** on the plan, then review again: it passes. In step 4, tick the consent box and press
   **Confirm demo order**. A demo order number appears. Nothing was bought.
5. **(1:20)** Change shipping, and the demo order is cleared. Tellr says the checkout changed and needs a new review.

## Accessibility notes
Tested in Chrome (desktop) with keyboard events and the accessibility tree:
- every control has a visible label or accessible name; status is shown with an icon and words, never color alone.
- after inspection, review, and confirmation, focus moves to the new result heading; progress and results are announced through
  one polite live region; errors use `role="alert"` and include **Try again**.
- step headings read as "Step N of 4: ..."; the progress list at the top links to each step.
- ⌘/Ctrl + Enter submits the requirements box; the whole flow works with the microphone unused.
- only the running action is disabled; the rest of the page stays usable.

**Not yet tested by a person:** a full macOS VoiceOver pass, and the real voice component with a configured Cartesia key.

Known gaps:
- the file picker is a visually hidden input with a styled label; VoiceOver reads it as a file button, but check it by hand.
- the quantity box saves on every valid keystroke, so typing "12" makes two checkout versions.
- when "Read responses aloud automatically" is on, the polite announcement and Sonic can overlap for screen-reader users. The
  voice component tells them to turn auto-read off.
- demo checkout terms (shipping, tax, delivery date) are fixed fictional values per listing, not estimates.
