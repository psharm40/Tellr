import test from "node:test";
import assert from "node:assert/strict";
import { createTalkGate } from "./talkGate.js";

function fake() {
  const calls = [];
  return {
    calls,
    stop() {
      calls.push("stop");
    },
    cancel() {
      calls.push("cancel");
    },
  };
}

test("a stop that missed its start does not cancel the next hold", () => {
  const gate = createTalkGate();
  assert.equal(gate.stop(1), "pending");
  const session = fake();
  gate.start(2, () => session);
  assert.deepEqual(session.calls, []);
});

test("stop for the hold that is recording stops that hold", () => {
  const gate = createTalkGate();
  const session = fake();
  gate.start(3, () => session);
  assert.equal(gate.stop(3), "stopped");
  assert.deepEqual(session.calls, ["stop"]);
});

test("stop that arrives before its own start still ends that start", () => {
  const gate = createTalkGate();
  assert.equal(gate.stop(4), "pending");
  const session = fake();
  gate.start(4, () => session);
  assert.deepEqual(session.calls, ["stop"]);
});
