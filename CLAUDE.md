# Tellr — shared instructions for Claude Code

## Product
Tellr is a voice-first shopping companion for blind and low-vision users.
Core demo: (1) speak shopping requirements, (2) inspect a secondhand listing's real uploaded photos and description, (3) identify visible flaws and missing evidence, (4) compare a simulated checkout against the shopper's original requirements, (5) read discrepancies aloud, and (6) explicitly confirm a DEMO order. No real purchases or payment-card collection.

## Tech and commands
- Next.js App Router, React, TypeScript, Tailwind, npm.
- Cartesia Ink for speech-to-text and Sonic for text-to-speech.
- Claude API for interpreting requirements and inspecting listing images.
- Deterministic TypeScript functions for totals, rule checks, and confirmation.
- `npm run dev`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Vercel deployment. Database is optional for the MVP; do not add one without agreement.

## Immutable shared contracts
- `src/types/tellr.ts` is the source of truth. Read it before coding.
- `docs/API_CONTRACTS.md` defines request and response payloads.
- Use camelCase for JS/TS fields, PascalCase for type names.
- All money fields end in `Cents`, are integers, and are in USD.
- Dates are `YYYY-MM-DD`; never infer unavailable shipping dates.
- Requirement result statuses: `supported`, `seller_claimed`, `contradicted`, `unknown`.
- Checkout result statuses: `pass`, `fail`, `unknown`.
- Never introduce differently named equivalents of these fields or enums.
- Changing shared contracts requires a coordinated pull request and notifying the team.

## Workstream ownership — do not cross boundaries without permission
1. UI/accessibility: `src/app/**` except `src/app/api/**`, `src/components/**`, `src/features/storefront/**`.
2. Voice/Cartesia: `src/features/voice/**`, `src/app/api/voice/**`.
3. Inspection/Claude: `src/features/inspection/**`, `src/app/api/requirements/**`, `src/app/api/inspection/**`.
4. Checkout/session: `src/features/checkout/**`, `src/app/api/checkout/**`, `src/lib/session/**`.
Shared `src/types/**`, `src/data/demo/**`, `docs/**`, `package.json` must be coordinated before editing. Owner assignments are roles; add names in docs/TEAM_WORKFLOW.md.

## Rules for implementation
- First inspect relevant code and shared types; do not rewrite or delete other teammates' work.
- Do not change files outside your assigned paths unless you explicitly flag the dependency.
- Do not make mock calls appear to be genuine AI verification.
- Image inspection: separate visual observation, seller assertion, contradiction, and unknown. Every claim cites image ID or description. No unsupported assurance of safety or function.
- Checkout: arithmetic in code, not an LLM. Unknown fields are never treated as a pass. Any changed checkout invalidates previous confirmation.
- Voice: always provide text equivalent, manual input and keyboard navigation; avoid fighting with screen-reader speech.
- Never auto-buy or request real payment-card details. Demo checkout only.
- Never put secrets into source, README, Google Docs, screenshots, commits, prompts, logs, or browser-visible `NEXT_PUBLIC_` fields.
- Prefer focused, accessible, working flows over unrelated extra features.
- Comments should be concise, plain language, lowercase.

## Before handing off a PR
1. Describe files changed and what works.
2. Run lint and TypeScript checks; include results.
3. Provide a screenshot or small reproduction sequence.
4. State blockers and any proposed changes to shared contracts.
5. Do not merge directly into `main`; open a PR with one reviewer if feasible.

See docs/TEAM_WORKFLOW.md and docs/CLAUDE_TASK_PROMPTS.md for assignments.
