import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// tables are added once the team agrees what to store (likely shopping sessions and checkout
// versions, owned by checkout/session). keep audio, transcripts, and raw photos out unless needed.
//
// PROPOSED (needs team / developer 4 review): savedItems, the shopper's saved list from the
// chrome extension, so it's there the next time tellr opens. one row per saved listing. owner is
// a random id per chrome profile (tellr has no login yet). no photos, audio, or payment data.
export default defineSchema({
  savedItems: defineTable({
    ownerId: v.string(),
    // the listing's id from its url, so the same item is saved once
    key: v.string(),
    url: v.string(),
    title: v.string(),
    description: v.string(),
    priceCents: v.number(),
    // tellr's judgement and notes when it was saved: great_pick, good_pick, okay_pick, risky, not_a_match, or ""
    fit: v.string(),
    flaw: v.string(),
    unknown: v.string(),
    // the kind of item (shoe, top, bottom, dress, outerwear, bag, ...), for reading the list by kind
    kind: v.string(),
    savedAt: v.number(),
  })
    .index("by_owner", ["ownerId", "savedAt"])
    .index("by_owner_key", ["ownerId", "key"]),
});
