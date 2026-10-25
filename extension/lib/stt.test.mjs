import { test } from "node:test";
import assert from "node:assert/strict";
import { createSttSession } from "./stt.js";

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  transcript(text, isFinal = false) {
    this.onmessage?.({ data: JSON.stringify({ type: "transcript", text, is_final: isFinal }) });
  }
  flush() {
    this.onmessage?.({ data: JSON.stringify({ type: "flush_done" }) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

test("stop before socket opens still yields empty, not a hang", async () => {
  const fake = new FakeSocket();
  globalThis.WebSocket = function () {
    return fake;
  };
  const events = [];
  const session = createSttSession(
    { token: "t", startCapture: async () => ({ stop() {} }) },
    (event) => events.push(event),
  );
  session.stop();
  await new Promise((r) => setTimeout(r, 20));
  fake.open();
  fake.flush();
  await new Promise((r) => setTimeout(r, 20));
  globalThis.WebSocket = OriginalWebSocket;
  const types = events.map((e) => e.type);
  assert.ok(types.includes("processing") || types.includes("empty") || types.includes("final"));
  assert.ok(types.includes("empty") || types.includes("final") || types.includes("error"), `stuck on ${types.join(",")}`);
});

test("audio queued before the socket opens is finalized", async () => {
  const fake = new FakeSocket();
  globalThis.WebSocket = function () {
    return fake;
  };
  const pcm = new Int16Array([1, 2, 3, 4]).buffer;
  const events = [];
  const session = createSttSession(
    {
      token: "t",
      startCapture: async (onChunk) => {
        onChunk(pcm);
        return { stop() {} };
      },
    },
    (event) => events.push(event),
  );
  session.stop();
  await new Promise((r) => setTimeout(r, 30));
  fake.open();
  await new Promise((r) => setTimeout(r, 20));
  globalThis.WebSocket = OriginalWebSocket;
  assert.equal(fake.sent.at(-1), "finalize");
  assert.ok(fake.sent.some((item) => item instanceof ArrayBuffer && item.byteLength === pcm.byteLength));
  assert.ok(events.some((event) => event.type === "processing"));
});

test("stop after transcript finalizes the spoken text", async () => {
  const fake = new FakeSocket();
  globalThis.WebSocket = function () {
    return fake;
  };
  const events = [];
  const session = createSttSession(
    { token: "t", startCapture: async () => ({ stop() {} }) },
    (event) => events.push(event),
  );
  await new Promise((r) => setTimeout(r, 10));
  fake.open();
  fake.transcript("running shoes", true);
  session.stop();
  fake.flush();
  await new Promise((r) => setTimeout(r, 20));
  globalThis.WebSocket = OriginalWebSocket;
  const final = events.find((e) => e.type === "final");
  assert.equal(final?.text, "running shoes");
});
