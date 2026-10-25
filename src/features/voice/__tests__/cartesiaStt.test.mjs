// deterministic tests for the stt session using fake socket, mic, and timers.
// run: node --test src/features/voice/__tests__/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSttUrl,
  createPcmChunker,
  createSttSession,
  describeMicError,
  MAX_LISTEN_MS,
  FINALIZE_TIMEOUT_MS,
} from "../cartesiaStt.ts";

const tick = () => new Promise((r) => setImmediate(r));

function makeHarness({ micError, tokenError } = {}) {
  const sent = [];
  const events = [];
  const timers = new Map();
  let nextTimer = 1;
  const state = { micStopped: 0, socket: null, onChunk: null };

  const deps = {
    async fetchToken() {
      if (tokenError) throw new Error(tokenError);
      return "tok_123";
    },
    openSocket(url) {
      const socket = {
        url,
        readyState: 0,
        closed: false,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send: (data) => sent.push(data),
        close() {
          socket.closed = true;
          socket.readyState = 3;
        },
      };
      state.socket = socket;
      return socket;
    },
    async startCapture(onChunk) {
      if (micError) throw micError;
      state.onChunk = onChunk;
      return { stop: () => state.micStopped++ };
    },
    setTimer(fn, ms) {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  };

  const open = () => {
    state.socket.readyState = 1;
    state.socket.onopen?.({});
  };
  const serverSends = (msg) => state.socket.onmessage?.({ data: JSON.stringify(msg) });
  const fireTimer = (ms) => {
    for (const [id, t] of timers) {
      if (t.ms === ms) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  const session = createSttSession(deps, (e) => events.push(e));
  return { session, events, sent, state, open, serverSends, fireTimer, timers };
}

const finals = (events) => events.filter((e) => e.type === "final");

test("builds the documented websocket url with the short-lived token", () => {
  const url = new URL(buildSttUrl("tok abc"));
  assert.equal(url.origin + url.pathname, "wss://api.cartesia.ai/stt/websocket");
  assert.equal(url.searchParams.get("model"), "ink-2");
  assert.equal(url.searchParams.get("encoding"), "pcm_s16le");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
  assert.equal(url.searchParams.get("cartesia_version"), "2026-08-14");
  assert.equal(url.searchParams.get("access_token"), "tok abc");
});

test("partials never emit final; one final per utterance after flush_done", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  assert.deepEqual(h.events.map((e) => e.type), ["mic_granted", "listening"]);

  h.state.onChunk(new ArrayBuffer(8));
  h.serverSends({ type: "transcript", is_final: false, text: "find a used" });
  h.serverSends({ type: "transcript", is_final: true, text: "Find a used laptop" });
  h.serverSends({ type: "transcript", is_final: false, text: " under three" });
  assert.equal(finals(h.events).length, 0);
  assert.equal(h.events.at(-1).text, "Find a used laptop under three");

  h.session.stop();
  assert.equal(h.state.micStopped, 1, "mic released as soon as stop is pressed");
  assert.equal(h.sent.at(-1), "finalize");

  h.serverSends({ type: "transcript", is_final: true, text: " under three hundred dollars." });
  h.serverSends({ type: "flush_done", request_id: "r1" });
  // late or duplicate messages after completion must not emit again
  h.serverSends({ type: "flush_done", request_id: "r1" });
  h.session.stop();

  assert.deepEqual(finals(h.events), [{ type: "final", text: "Find a used laptop under three hundred dollars." }]);
  assert.ok(h.sent.includes("close"));
  assert.equal(h.state.socket.closed, true);
  assert.equal(h.timers.size, 0, "no timers left running");
});

test("audio captured before the socket opens is queued and flushed in order", async () => {
  const h = makeHarness();
  await tick();
  const a = new ArrayBuffer(2);
  const b = new ArrayBuffer(4);
  h.state.onChunk(a);
  h.state.onChunk(b);
  assert.equal(h.sent.length, 0);
  h.open();
  assert.deepEqual(h.sent, [a, b]);
});

test("stop before the socket opens still finalizes once connected", async () => {
  const h = makeHarness();
  await tick();
  h.session.stop();
  assert.equal(h.state.micStopped, 1);
  h.open();
  assert.equal(h.sent.at(-1), "finalize");
  h.serverSends({ type: "transcript", is_final: true, text: "hello" });
  h.serverSends({ type: "flush_done", request_id: "r" });
  assert.equal(finals(h.events).length, 1);
});

test("empty utterance emits empty, not final", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.session.stop();
  h.serverSends({ type: "flush_done", request_id: "r" });
  assert.equal(finals(h.events).length, 0);
  assert.equal(h.events.at(-1).type, "empty");
});

test("cancel releases mic and socket and never emits a transcript", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.serverSends({ type: "transcript", is_final: true, text: "half a sentence" });
  h.session.cancel();
  assert.equal(h.state.micStopped, 1);
  assert.equal(h.state.socket, h.state.socket);
  h.serverSends({ type: "flush_done", request_id: "r" });
  assert.equal(finals(h.events).length, 0);
  assert.equal(h.timers.size, 0);
});

test("cancel while the mic prompt is pending stops the mic once granted", async () => {
  const h = makeHarness();
  h.session.cancel();
  await tick();
  assert.equal(h.state.micStopped, 1);
  assert.equal(h.state.socket, null, "socket never opened");
  assert.equal(h.events.length, 0);
});

test("denied microphone reports mic_denied with a typed-input fallback", async () => {
  const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const h = makeHarness({ micError: err });
  await tick();
  const last = h.events.at(-1);
  assert.equal(last.type, "error");
  assert.equal(last.kind, "mic_denied");
  assert.match(last.message, /type/i);
  assert.equal(h.state.socket, null);
});

test("token failure surfaces the server message and opens no socket", async () => {
  const h = makeHarness({ tokenError: "Voice is not configured on this server." });
  await tick();
  const last = h.events.at(-1);
  assert.equal(last.kind, "unavailable");
  assert.match(last.message, /not configured/);
  assert.equal(h.state.micStopped, 0, "capture promise rejected path does not leak");
});

test("cartesia error message tears down the session", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.serverSends({ type: "error", status_code: 401, title: "Unauthorized", message: "token expired" });
  assert.equal(h.events.at(-1).kind, "stt_error");
  assert.equal(h.state.micStopped, 1);
});

test("unexpected socket close is reported as a network error", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.state.socket.onclose({});
  assert.equal(h.events.at(-1).kind, "network");
});

test("listening auto-stops at the max duration", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.fireTimer(MAX_LISTEN_MS);
  assert.equal(h.state.micStopped, 1);
  assert.equal(h.sent.at(-1), "finalize");
});

test("missing flush_done times out instead of hanging", async () => {
  const h = makeHarness();
  await tick();
  h.open();
  h.session.stop();
  h.fireTimer(FINALIZE_TIMEOUT_MS);
  assert.equal(h.events.at(-1).kind, "timeout");
  assert.equal(finals(h.events).length, 0);
});

test("describeMicError maps browser errors", () => {
  assert.equal(describeMicError({ name: "NotFoundError" }).kind, "no_mic");
  assert.equal(describeMicError({ name: "NotSupportedError" }).kind, "mic_unsupported");
  assert.equal(describeMicError(new Error("x")).kind, "mic_error");
});

test("pcm chunker downsamples 48 kHz to 16 kHz int16 in 100ms chunks", () => {
  const chunks = [];
  const chunker = createPcmChunker(48000, (buf) => chunks.push(new Int16Array(buf)));
  // 0.25s of a constant 0.5 signal, pushed in uneven pieces
  const total = 12000;
  let pushed = 0;
  for (const size of [128, 4000, 7, 7865]) {
    chunker.push(new Float32Array(size).fill(0.5));
    pushed += size;
  }
  assert.equal(pushed, total);
  chunker.flush();
  assert.deepEqual(chunks.map((c) => c.length), [1600, 1600, 800]);
  assert.ok(chunks.every((c) => c.every((s) => s === Math.trunc(0.5 * 0x7fff))));
});

test("pcm chunker clamps out-of-range samples", () => {
  const chunks = [];
  const chunker = createPcmChunker(16000, (buf) => chunks.push(new Int16Array(buf)));
  chunker.push(Float32Array.from([2, -2]));
  chunker.flush();
  assert.deepEqual(Array.from(chunks[0]), [0x7fff, -0x8000]);
});
