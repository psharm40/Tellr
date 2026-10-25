// the shopper's saved list (the extension's shortlist), so it's there the next time tellr opens.
// called only by the next.js route /api/saved, which validates input first.
// PROPOSED (needs team / developer 4 review), see convex/schema.ts.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const MAX_SAVED = 30;

const item = v.object({
  key: v.string(),
  url: v.string(),
  title: v.string(),
  description: v.string(),
  priceCents: v.number(),
  fit: v.string(),
  flaw: v.string(),
  unknown: v.string(),
  kind: v.string(),
  savedAt: v.number(),
});

// oldest first, so "saved 1" stays the same item as more are added
export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db
      .query("savedItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("asc")
      .take(MAX_SAVED);
    return rows.map(({ key, url, title, description, priceCents, fit, flaw, unknown, kind, savedAt }) => ({
      key, url, title, description, priceCents, fit, flaw, unknown, kind, savedAt,
    }));
  },
});

// adds the item, or updates it if this owner already saved the same listing
export const save = mutation({
  args: { ownerId: v.string(), item },
  handler: async (ctx, { ownerId, item: saved }) => {
    const existing = await ctx.db
      .query("savedItems")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", saved.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...saved, savedAt: existing.savedAt });
      return;
    }
    const count = (await ctx.db.query("savedItems").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(MAX_SAVED)).length;
    if (count >= MAX_SAVED) throw new Error("saved list is full");
    await ctx.db.insert("savedItems", { ownerId, ...saved });
  },
});

export const remove = mutation({
  args: { ownerId: v.string(), key: v.string() },
  handler: async (ctx, { ownerId, key }) => {
    const existing = await ctx.db
      .query("savedItems")
      .withIndex("by_owner_key", (q) => q.eq("ownerId", ownerId).eq("key", key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const clear = mutation({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db.query("savedItems").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(MAX_SAVED);
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
