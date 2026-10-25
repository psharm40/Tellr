# Developer 3 integration guide — requirements, inspection & conversational AI

Written for: Tellr teammates (Dev 1 storefront, Dev 2 voice, Dev 4 checkout).

Developer 3 owns the AI feature: turning shopper language into structured
preferences, inspecting real listing photos for evidence-based findings, and
explaining those findings conversationally. Everything conforms to the frozen types
in `src/types/tellr.ts` and `docs/API_CONTRACTS.md`. No shared contracts were changed.

## Endpoints & reusable functions

| Thing | Path / import | Shape | Status |
|---|---|---|---|
| Requirements API | `POST /api/requirements` | `{ text }` → `{ preferences, clarificationQuestions }` | frozen contract |
| Inspection API | `POST /api/inspection` | `{ listing, preferences }` → `{ report }` | frozen contract |
| Conversational Q&A API | `POST /api/inspection/explain` | `{ report, preferences, question, listing?, history? }` → `{ answer }` | **PENDING lead approval** (new endpoint) |
| Friendly summary (fn) | `summarizeInspectionForShopper(report, preferences, listing?)` | → `string` | ready |

All routes validate input first and return `{ error: string }` with a non-2xx status
on failure: **400** bad input, **502** bad model output, **503** model unavailable,
**500** unexpected. Nothing secret is logged. Model: `claude-haiku-4-5-20251001`
(server env `ANTHROPIC_MODEL`); keys stay server-side.

---

## 1. Requirements API — `POST /api/requirements`

Request:
```json
{ "text": "used laptop under $300, no cracked screen, must have a charger, no subscriptions" }
```
Response `200`:
```json
{
  "preferences": {
    "category": "laptop",
    "maxTotalCents": 30000,
    "requirements": [
      { "id": "req|screen_condition|equals|s:no_cracks|required", "attribute": "screen_condition", "operator": "equals", "value": "no_cracks", "priority": "required" },
      { "id": "req|charger_included|equals|b:true|required", "attribute": "charger_included", "operator": "equals", "value": true, "priority": "required" },
      { "id": "req|no_subscription|equals|b:true|required", "attribute": "no_subscription", "operator": "equals", "value": true, "priority": "required" }
    ]
  },
  "clarificationQuestions": []
}
```
Render `clarificationQuestions`; let the shopper edit the text and re-submit. Don't
silently rewrite `preferences`. Budget is integer cents (`$300 → 30000`).

## 2. Inspection API — `POST /api/inspection`

Build the `Listing` with images as **base64 data URLs** (`data:image/jpeg|png|webp;base64,...`),
**1–3 images, ≤5 MB each, ≤15 MB total**. Remote (`http(s)`) image URLs are rejected
by design (no server-side fetch → SSRF-safe).
```json
{
  "listing": {
    "id": "laptop-001", "title": "Dell laptop", "description": "Works great, no issues.",
    "category": "laptop", "itemPriceCents": 25000, "currency": "USD",
    "images": [{ "id": "photo-1", "url": "data:image/jpeg;base64,/9j/4AAQ...", "alt": "seller photo; condition unverified" }]
  },
  "preferences": { "...": "the object from /api/requirements" }
}
```
Response `200` (`{ report }`, an `InspectionReport`):
```json
{
  "report": {
    "listingId": "laptop-001",
    "evidence": [
      { "id": "ev-1", "sourceType": "photo", "sourceId": "photo-1", "observation": "a spider-web crack across the screen in photo-1" },
      { "id": "ev-2", "sourceType": "description", "sourceId": "listing-description", "observation": "seller says a charger is included" }
    ],
    "assessments": [
      { "requirementId": "req|screen_condition|equals|s:no_cracks|required", "status": "contradicted", "explanation": "the photo shows a cracked screen", "evidenceIds": ["ev-1"] },
      { "requirementId": "req|charger_included|equals|b:true|required", "status": "seller_claimed", "explanation": "claimed in the description but not shown in any photo", "evidenceIds": ["ev-2"], "followUpQuestion": "could you send a photo of the charger?" }
    ],
    "sellerQuestions": ["Can you confirm the screen still works despite the crack?"]
  }
}
```
Re-POST a fresh request whenever images/description/requirements change — everything
is recomputed (no stale findings). `status` ∈ `supported | seller_claimed |
contradicted | unknown`. Photo evidence `sourceId` is always a real `ListingImage.id`;
description evidence uses `"listing-description"`.

## 3. Friendly summary — `summarizeInspectionForShopper(...)`

Deterministic (no extra API call), accurate to the report, short enough to speak:
```ts
import { summarizeInspectionForShopper } from "@/features/inspection/summarizeInspection";
const spoken = summarizeInspectionForShopper(report, preferences, listing);
```
Example output:
> "Here's my read on Dell laptop: Heads up — the screen looks cracked or damaged, which
> you specifically wanted to avoid — a cracked screen is costly to fix and hard to read.
> The seller says a charger's included, but I can't see one in the photos, so I'd confirm
> it. If it were me, I'd ask the seller: Can you confirm the screen still works despite
> the crack?"

It reads the requirement's actual operator/value, leads with serious contradictions of
required requirements, never calls allowed-scratches "clean", and only says "in the
photos" when photo evidence backs it.

## 4. Conversational Q&A — `POST /api/inspection/explain`  *(PENDING APPROVAL)*

For open-ended questions ("what do you think?", "where's the damage?", "would you
recommend it?", "does it come with a charger?", "what can't you tell?"). Grounded in the
report — it won't invent observations or specs. Supports follow-ups via `history`.

Request:
```json
{
  "report": { "...": "the InspectionReport from /api/inspection" },
  "preferences": { "...": "the ShoppingPreferences" },
  "question": "Would you recommend buying this?",
  "listing": { "...": "optional; only title/price are used for context" },
  "history": [
    { "role": "user", "text": "What do you think about this laptop?" },
    { "role": "assistant", "text": "The screen looks cracked, so I'd be cautious." }
  ]
}
```
Response `200`:
```json
{ "answer": "Honestly, I'd hold off. The screen's clearly cracked in the photos, which you said you wanted to avoid, and a cracked screen is pricey to fix. The charger's only mentioned in the text, not shown — so I'd ask the seller for a photo of it before deciding." }
```
`question` ≤ 500 chars; `history` ≤ 6 turns. The question and any listing text are
treated as untrusted (prompt-injection resistant). Errors use the same `{ error }`
shape and status codes as the other routes.

> ⚠️ This endpoint is **not** in `docs/API_CONTRACTS.md` yet. The request/response shape
> above is the proposed contract — **please approve it before we rely on it.** It is
> implemented entirely in Dev 3's owned paths; no frozen contract was modified.

---

## For Developer 1 (storefront)

- Call the APIs with `fetch`; on non-2xx, show `(await res.json()).error` and offer retry.
- **Display the report:** per `assessment`, resolve `requirementId` against
  `preferences.requirements[].id`, show `status` in words (non-color-only), the
  `explanation`, and resolve each `evidenceIds[]` against `report.evidence` by `id`
  (show `observation` + which photo via `sourceId`). Keep `unknown` findings visible.
- **For the overview / voice:** use `summarizeInspectionForShopper(...)`.
- **For questions:** POST `/api/inspection/explain` (once approved) and show `answer`.

## For Developer 2 (voice)

Dev 1 produces the text (summary or Q&A `answer`) and passes it to `VoiceAssistant` as
`speechRequest: { id, text }` (new `id` per playback). The voice module never calls the
inspection APIs — it only speaks the text it's given, and the same text is shown on
screen. Both the summary and the Q&A answers are already short, plain-language, and
money-/jargon-safe for Sonic. (`VoiceIntent` already includes `explain_findings` and
`ask_seller_questions`.)

## For Developer 4 (checkout)

- Dev 4 consumes **`ShoppingPreferences`** from `/api/requirements` — `maxTotalCents`
  and the canonical requirements (`quantity`, `delivery_by_date`, `no_unrequested_addons`,
  `no_subscription`, …) — to drive the deterministic checkout checks. The requirement
  `attribute`/`id` vocabulary is the shared key.
- Inspection and checkout stay **decoupled**: checkout must not treat inspection
  `unknown`/`seller_claimed` findings as verified, and inspection doesn't compute totals.
  Dev 4 does **not** need the `InspectionReport` for arithmetic.

## Limitations / still needed from the team

- **Approve the `/api/inspection/explain` contract** (one row in `docs/API_CONTRACTS.md`).
  The code is done and tested (mocked); it just needs the contract blessed.
- **Canonical demo `Listing` + licensed photos** in `src/data/demo/**` — owned by
  lead/Dev 1, not Dev 3.
- **Live model behavior** was validated with one real 3-photo run (cracked screen
  correctly caught as a contradiction; charger correctly kept as a seller claim; closed-
  lid screen correctly `unknown`). All engine/validation logic is covered by mocked
  tests. Run one live smoke test per environment before the demo.
- Config: set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` in
  `.env.local` (server-side only).
