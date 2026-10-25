// the saved-list checks, with a fake convex store (no database). run:
// node --test src/features/saved/__tests__/saved.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SavedError, listSaved, removeSaved, saveItem } from "../savedItems.ts";

const OWNER = "3f9a2c1e-8b7d-4e6f-a5c4-1d2e3f4a5b6c";
const item = { key: "1234567890", url: "https://www.ebay.com/itm/1234567890", title: "Brown loafers", description: "A brown slip-on loafer", priceCents: 2600, fit: "good_pick", flaw: "", unknown: "The size isn't shown.", kind: "shoe", savedAt: 1 };

function fakeStore() {
  const rows = new Map();
  const calls = [];
  return {
    calls,
    list: async (owner) => { calls.push(["list", owner]); return [...rows.values()].filter((r) => r.owner === owner).map((r) => r.item); },
    save: async (owner, saved) => { calls.push(["save", owner]); rows.set(`${owner}:${saved.key}`, { owner, item: saved }); },
    remove: async (owner, key) => { calls.push(["remove", owner, key]); rows.delete(`${owner}:${key}`); },
    clear: async (owner) => { calls.push(["clear", owner]); for (const k of [...rows.keys()]) if (k.startsWith(owner)) rows.delete(k); },
  };
}

test("save, list, remove, clear for one owner", async () => {
  const store = fakeStore();
  assert.deepEqual(await saveItem(store, { ownerId: OWNER, item }), { ok: true });
  assert.deepEqual((await listSaved(store, OWNER)).items, [item]);
  await removeSaved(store, { ownerId: OWNER, key: item.key });
  assert.deepEqual((await listSaved(store, OWNER)).items, []);
  await saveItem(store, { ownerId: OWNER, item });
  await removeSaved(store, { ownerId: OWNER });
  assert.deepEqual((await listSaved(store, OWNER)).items, []);
  assert.deepEqual(store.calls.at(-2), ["clear", OWNER]);
});

test("bad requests are refused before reaching the database", async () => {
  const store = fakeStore();
  const refused = async (work) => {
    await assert.rejects(work, (error) => error instanceof SavedError && error.status === 400);
  };
  await refused(() => listSaved(store, "short"));
  await refused(() => saveItem(store, { ownerId: OWNER, item: { ...item, url: "javascript:alert(1)" } }));
  await refused(() => saveItem(store, { ownerId: OWNER, item: { ...item, priceCents: -5 } }));
  await refused(() => saveItem(store, { ownerId: OWNER, item: { ...item, fit: "amazing" } }));
  await refused(() => saveItem(store, { ownerId: OWNER, item: { ...item, title: "x".repeat(301) } }));
  await refused(() => removeSaved(store, { ownerId: "../../etc" }));
  assert.equal(store.calls.length, 0);
});
