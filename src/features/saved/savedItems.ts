// the shopper's saved list, kept in convex so it's there the next time tellr opens.
// this module checks every request and talks to convex through functions passed in, so it can be
// tested without a database. the route /api/saved wires it to the real convex client.
//
// PROPOSED (needs team / developer 4 review): new endpoint, not yet in docs/API_CONTRACTS.md.
//   GET    /api/saved?owner=<ownerId>            -> { items: SavedItem[] }
//   POST   /api/saved { ownerId, item }          -> { ok: true }    (adds or updates by item.key)
//   DELETE /api/saved { ownerId, key? }          -> { ok: true }    (no key: clears the list)
// the owner id is a random id per chrome profile (no login yet), so it works like a private key.

import { z } from "zod";

const FITS = ["", "great_pick", "good_pick", "okay_pick", "risky", "not_a_match"] as const;

export const ownerIdSchema = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);

export const savedItemSchema = z.object({
  key: z.string().trim().min(1).max(100),
  url: z.string().url().max(1000).refine((url) => /^https?:\/\//i.test(url)),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(400),
  priceCents: z.number().int().min(0).max(100_000_000),
  fit: z.enum(FITS),
  flaw: z.string().max(300),
  unknown: z.string().max(300),
  kind: z.string().max(30),
  savedAt: z.number().int().min(0),
});

export type SavedItem = z.infer<typeof savedItemSchema>;

export class SavedError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// a saved item as the database returns it (its fit is plain text there)
export type StoredItem = Omit<SavedItem, "fit"> & { fit: string };

// the three things the route needs from convex, as plain functions
export type SavedStore = {
  list: (ownerId: string) => Promise<StoredItem[]>;
  save: (ownerId: string, item: SavedItem) => Promise<unknown>;
  remove: (ownerId: string, key: string) => Promise<unknown>;
  clear: (ownerId: string) => Promise<unknown>;
};

export async function listSaved(store: SavedStore, ownerId: unknown) {
  const owner = ownerIdSchema.safeParse(ownerId);
  if (!owner.success) throw new SavedError("A valid owner id is required.", 400);
  return { items: await store.list(owner.data) };
}

export async function saveItem(store: SavedStore, body: unknown) {
  const parsed = z.object({ ownerId: ownerIdSchema, item: savedItemSchema }).safeParse(body);
  if (!parsed.success) throw new SavedError("The saved item is invalid.", 400);
  await store.save(parsed.data.ownerId, parsed.data.item);
  return { ok: true as const };
}

export async function removeSaved(store: SavedStore, body: unknown) {
  const parsed = z.object({ ownerId: ownerIdSchema, key: z.string().trim().min(1).max(100).optional() }).safeParse(body);
  if (!parsed.success) throw new SavedError("A valid owner id is required.", 400);
  if (parsed.data.key) await store.remove(parsed.data.ownerId, parsed.data.key);
  else await store.clear(parsed.data.ownerId);
  return { ok: true as const };
}
