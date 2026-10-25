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

`src/features/voice/cartesiaServer.ts` (`assertSameOrigin`) now allows this extension's origin, `chrome-extension://cjmaabcdoilmjgnmihmbcfhchnlhjimg`. Other extensions are still rejected, so they can't spend the team's Cartesia quota. If the extension is re-keyed or published with a different id, add it to the server env as `TELLR_EXTENSION_IDS` (comma-separated). This is a coordinated edit to a voice-owned file. Call it out in the PR.

## Talking to Tellr (and not the Mac)

Tellr only listens while you ask it to, with keys macOS and VoiceOver don't use:

| How | Keys | Notes |
|---|---|---|
| Hold to talk | **Option+Space** on the shopping page | Release to finish |
| Press to toggle | **Option+Shift+L** anywhere in Chrome | Press again to stop, or it stops after 12 s |
| Open the side panel | **Option+Shift+T** | Change these at `chrome://extensions/shortcuts` |
| Button | **Start listening** in the side panel | Same as the toggle |

You hear a **rising tone** when the mic is recording, a **falling tone** when it stops, and a **low tone** on errors. Settings refuses keys that Spotlight, Siri, VoiceOver, or the language switcher already use (Command+Space, Control+Option, Control+Space, Command+F5).

Scope: Tellr is the safety layer for the shopping page you're on. Getting to a site, moving around a page, and reading everything else stay with VoiceOver, Siri, and Chrome. The one exception is "find ___ on eBay/Amazon", which opens that site's search results.

## You never need to remember commands

Every voice command has a side panel button, and every answer ends with what you can say next.

| Say | Button | What happens |
|---|---|---|
| "Help" / "What can I say?" | What can I say? | Commands for the step you're on |
| "Say that again" | Say that again | Repeats the last answer |
| "A black jacket under $80" | Type it and Send | Saves what you need |
| "Find black jackets under $100 on eBay" | (type it) | Saves what you need and opens eBay results in a new tab |
| "List them" / "More" | List items on this page / More items | Reads 5 numbered items at a time |
| "Open number 2" / "the second one" | Open (next to each item) | Opens that item |
| "Check this item" | Check this item | Claude inspects the photos. On a results page it asks which item instead |
| "Review checkout" | Review checkout | Checks the fees, always from a fresh read of the page |
| "Confirm", then "Yes, confirm" | Confirm, then Yes, confirm | Reads back item and total first; "Cancel" or "No" stops it. Any checkout change cancels the read-back |
| "Compare the top 3" / "check numbers 1 to 3" / "compare 1, 3 and 5" | Compare top 3 | Inspects up to 3 results in background tabs at once and ranks them by fit. Opening one afterwards reuses its inspection |
| "Actually only up to $25" / "size 8" (on a results page) | (type it) | Updates the requirements and re-screens the page: "now 4 items fit" |
| "Start over" | | Clears the shopping goal |

## Narrowing down a search

1. Say what you want: item, color, wear, budget ("20 to 30 dollars"), size. Tellr asks at most two short questions (usually size), and answering them just works.
2. "List them" screens the results page. Items over budget (or under a stated minimum) are dropped and counted ("Of 48 items, 9 fit your $20 to $30 budget, before shipping"). Titles that mention your color, size, or material come first; titles are often incomplete, so they only re-order, never hide.
3. Change your mind any time ("actually up to $40", "black is fine too"). The later statement wins, and the page is re-screened.
4. "Compare the top 3" runs the full photo inspection on each and reads back the best fit first, in plain terms ("color looks right; wear level can't be told from the photos").
5. "Open number 2", ask questions, then "review checkout".

## Photo inspection precision

- Only the listing's own gallery is inspected. Photos that link to other listings ("similar items") are skipped, and other products' titles aren't passed along as the description.
- eBay and Amazon photos are fetched at full size (eBay `s-l1600`, Amazon originals), then scaled to 1568 px.
- The inspection prompt follows a fixed method: a per-photo inventory, a list of areas not shown, a defect scan with the checklist for the item type (shoes, clothing, bags, electronics), then assessments. Color, size, wear, and material each have their own rules (for example, size counts as "supported" only from a legible tag).
- Set `ANTHROPIC_INSPECTION_MODEL` on the server to use a stronger vision model for inspection only. On a test listing with a worn sole edge and a wrong-item photo, Claude Opus 5.5 caught both and placed the scuffs exactly; Haiku 4.5 missed the scuffs. It's slower (about 25 s vs 15 s per item).

## Stop speaking and screen readers

- **Stop speaking** in the side panel silences the current answer right away, including one still loading. Starting to talk also cuts Tellr off.
- **Pause** ("stop", "pause", "hold on", "give me a minute", or the Pause Tellr button): Tellr goes quiet and remembers everything. Anything that finishes during the pause waits; "resume" says it. Talking to Tellr about anything else also ends the pause.
- **Done shopping** ("I'm done shopping for today", "that's all for today", "I give up"): Tellr asks first, then clears the goal, results, and inspections only on "yes". "Start over" still clears right away.
- **Live caption:** while Tellr talks, its words appear in a large caption in the side panel and the page bubble. Timing is spread evenly over the audio (Cartesia's mp3 has no word timings), so it's close, not exact. The caption is hidden from screen readers so they don't read over the voice; the full answer text stays in the panel.
- When "Speak answers" is on, the page bubble and side panel show the answer but don't announce it, so VoiceOver doesn't read it a second time. Turn "Speak answers" off in Settings to have the screen reader announce answers instead.

## Searching

- The search is built in code from what you said: the specific kind of item you named ("loafers", "tank top") instead of a broad category, plus color, material, size, and price range.
- **Filters that fit the request:** Buy It Now only (bidding is hard to follow by voice) unless you mention auctions; new-only or used-only when you say so; cheapest first ("cheapest first", "sort by price") using price plus shipping. On Amazon, the price range and cheapest-first sort are applied too.
- If fewer than 2 of the first 8 results look like good picks, Tellr checks the next 8 before choosing its top 3.
- **Naming a different kind of item starts fresh:** asking for "a black tank top" while shopping for shoes drops the shoe goal, so it isn't carried into the new search. Style or occasion answers ("for work") re-judge the current results instead of searching again.

## Turning on, off, and talking

- **Turning on with Option+Shift+L or the Start listening button** (first time per browser session, or after "turn off"): Tellr says where you are ("You're on the eBay home page…" / search results / a listing / cart / checkout), then asks "What are you shopping for today?" (or picks up the last goal), and the mic opens by itself. **Holding the talk key always listens right away**, because you're already talking; if you hold it and say nothing on a first visit, you get the welcome instead.
- **Hands-free listening:** with the toggle shortcut, a button, or after the welcome, the mic closes about 1.6 seconds after you stop talking (or after 8 seconds of silence). Holding the key still works as before.
- **"Shut up", "stop":** quiet right away (a pause). **"Turn off", "shut up and close", "close Tellr", "go away":** the mic closes, the side panel closes (Chrome 141+), page boxes come off, and Tellr says nothing more until it's turned back on. Memory is kept. Work still finishing in the background stays silent and draws nothing on the page.
- **"Where am I?"** says which page you're on at any time.
- **Knowing Tellr is working:** a soft tick every 1.5 seconds while it's busy and not talking (none for quick answers). After 12 quiet seconds it says "Still searching for that" (at most twice). "Are you there?" or "what are you doing?" answers right away without interrupting the work. Three rising tones mean on, three falling mean off.
- **Backup voice:** if Cartesia can't speak (out of credits, offline, too slow), Chrome's built-in voice says the answer instead, and says once that it's the backup. Listening still needs Cartesia.
- **Prices are spoken naturally:** "28 dollars", "60 dollars and 50 cents", never "28 point zero zero".
- **Photos:** up to 8 listing photos are checked (the server limit in `src/features/inspection/imageValidation.ts`, Developer 3's file, was raised from 3). Tellr says "all 5 photos" or "the first 8 of 12 photos".
- **Speech never cuts itself off:** lines play in order, and long answers are sent a sentence or two at a time. Only you interrupt: talking, stop, pause, or off.

## About the listing

- "Can I trust this seller?" reads the seller's positive feedback, number of ratings, items sold, join date, and reply time from the page, with a plain read of the track record. A rating never promises anything about the item.
- "How popular is it?" reads how many sold, how many are watching, carts, and how many are left. "What's the return policy?", "where does it ship from?", "item details", and "tell me everything on this page" read the other groups.
- The side panel lists the same facts under one heading per topic. Item details that match your requirements (size, color, material) come first.
- When you say you're done shopping and confirm, Tellr also removes its boxes and numbers from every open page.

## Questions about checkout

- "Why is the tax so high?" or "what's the shipping?" answers from the numbers already read off the page instead of re-running the review. Tellr never works out tax itself, and it flags a tax over 15 percent of the item as probably misread.
- Tax and shipping are only read from a labeled row ("Tax", "Estimated tax", "Shipping"). Fine print like "sales tax may apply" is ignored, so a listing page shows tax as not shown instead of guessing.

## Safety

- No real buy/checkout clicks
- No payment fields or passwords
- Unknown shipping, tax, or delivery stays `null`
- Detected protection plans are sent as `explicitlyAccepted: false`
- Photos are observations only. Tellr will not claim they prove function, battery health, or hidden damage
- Page and seller text are untrusted
