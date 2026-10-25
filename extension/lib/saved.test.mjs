// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { forServer, mergeSaved, queueOp } from "./saved.js";

const a = { key: "1", title: "A" };
const b = { key: "2", title: "B" };

test("changes waiting for the server: the newest change to an item wins; clear replaces all", () => {
  let pending = queueOp([], { op: "save", item: a });
  pending = queueOp(pending, { op: "save", item: b });
  pending = queueOp(pending, { op: "remove", key: "1" });
  assert.deepEqual(pending, [{ op: "save", item: b }, { op: "remove", key: "1" }]);
  assert.deepEqual(queueOp(pending, { op: "clear" }), [{ op: "clear" }]);
});

test("the list shown is the server's, with waiting changes applied", () => {
  assert.deepEqual(mergeSaved([a], [{ op: "save", item: b }]), [a, b]);
  assert.deepEqual(mergeSaved([a, b], [{ op: "remove", key: "1" }]), [b]);
  assert.deepEqual(mergeSaved([a], [{ op: "save", item: { key: "1", title: "A2" } }]), [{ key: "1", title: "A2" }]);
  assert.deepEqual(mergeSaved([a, b], [{ op: "clear" }, { op: "save", item: a }]), [a]);
  // offline at first: nothing from the server yet, the waiting saves still show
  assert.deepEqual(mergeSaved([], [{ op: "save", item: a }]), [a]);
});

test("only what the server accepts is sent", () => {
  const sent = forServer({ key: "1", url: "https://x.com/itm/1", title: "", priceCents: 26.4, fit: "amazing", extra: "dropped", savedAt: 5 });
  assert.equal(sent.title, "Untitled item");
  assert.equal(sent.priceCents, 26);
  assert.equal(sent.fit, "");
  assert.equal("extra" in sent, false);
});
