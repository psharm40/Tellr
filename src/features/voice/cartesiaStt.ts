// browser-safe cartesia ink speech-to-text session (push-to-talk)
// protocol: wss://api.cartesia.ai/stt/websocket, raw pcm frames in, "finalize" on stop,
// join only is_final transcript chunks, wait for flush_done, then "close".
// keep this file free of relative imports so node --test can load it directly.

export const CARTESIA_VERSION = "2026-08-14";
export const STT_MODEL_ID = "ink-2";
export const STT_SAMPLE_RATE = 16000;
export const STT_SOCKET_BASE = "wss://api.cartesia.ai/stt/websocket";

// cap a single utterance so the mic is never left open indefinitely
export const MAX_LISTEN_MS = 30_000;
export const FINALIZE_TIMEOUT_MS = 10_000;
// queue cap while the socket is still connecting (~10s of 100ms frames)
const MAX_QUEUED_CHUNKS = 100;

export function buildSttUrl(accessToken: string): string {
  const params = new URLSearchParams({
    model: STT_MODEL_ID,
    encoding: "pcm_s16le",
    sample_rate: String(STT_SAMPLE_RATE),
    cartesia_version: CARTESIA_VERSION,
    access_token: accessToken,
  });
  return `${STT_SOCKET_BASE}?${params.toString()}`;
}

// downsamples float32 mic audio to 16 kHz pcm_s16le and emits ~100ms chunks
export function createPcmChunker(
  inputSampleRate: number,
  onChunk: (pcm: ArrayBuffer) => void,
  targetSampleRate: number = STT_SAMPLE_RATE,
  chunkMs = 100,
) {
  const ratio = inputSampleRate / targetSampleRate;
  const chunkSamples = Math.round((targetSampleRate * chunkMs) / 1000);
  let carry = new Float32Array(0);
  let out = new Int16Array(chunkSamples);
  let outLen = 0;

  function emit() {
    if (outLen === 0) return;
    onChunk(out.slice(0, outLen).buffer);
    out = new Int16Array(chunkSamples);
    outLen = 0;
  }

  return {
    push(samples: Float32Array) {
      const input = new Float32Array(carry.length + samples.length);
      input.set(carry, 0);
      input.set(samples, carry.length);
      const produced = Math.floor(input.length / ratio);
      for (let i = 0; i < produced; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        const s = Math.max(-1, Math.min(1, sum / (end - start)));
        out[outLen++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (outLen === chunkSamples) emit();
      }
      carry = input.slice(Math.floor(produced * ratio));
    },
    flush() {
      emit();
      carry = new Float32Array(0);
    },
  };
}

export type SttErrorKind =
  | "mic_denied"
  | "no_mic"
  | "mic_unsupported"
  | "mic_error"
  | "unavailable"
  | "network"
  | "timeout"
  | "stt_error";

export type SttEvent =
  | { type: "mic_granted" }
  | { type: "listening" }
  | { type: "partial"; text: string }
  | { type: "processing" }
  | { type: "final"; text: string }
  | { type: "empty" }
  | { type: "error"; kind: SttErrorKind; message: string };

export interface SocketLike {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export interface MicCapture {
  stop(): void;
}

export interface SttDeps {
  fetchToken(signal: AbortSignal): Promise<string>;
  openSocket(url: string): SocketLike;
  startCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<MicCapture>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

const SOCKET_OPEN = 1;

export function describeMicError(err: unknown): { kind: SttErrorKind; message: string } {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      kind: "mic_denied",
      message:
        "Microphone access was blocked. You can type your request instead, or allow the microphone in your browser settings and try again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { kind: "no_mic", message: "No microphone was found. You can type your request instead." };
  }
  if (name === "NotSupportedError") {
    return {
      kind: "mic_unsupported",
      message: "This browser can't record audio here. You can type your request instead.",
    };
  }
  return {
    kind: "mic_error",
    message: "The microphone couldn't be started. You can type your request instead.",
  };
}

type Phase = "starting" | "streaming" | "finalizing" | "closed";

// one session = one utterance. emits "final" or "empty" at most once, and never after cancel().
export function createSttSession(deps: SttDeps, emit: (event: SttEvent) => void) {
  let phase: Phase = "starting";
  let stopRequested = false;
  let socket: SocketLike | null = null;
  let capture: MicCapture | null = null;
  let queue: ArrayBuffer[] = [];
  let finalText = "";
  let maxTimer: unknown = null;
  let finalizeTimer: unknown = null;
  const abort = new AbortController();

  function teardown() {
    phase = "closed";
    abort.abort();
    if (maxTimer !== null) deps.clearTimer(maxTimer);
    if (finalizeTimer !== null) deps.clearTimer(finalizeTimer);
    maxTimer = finalizeTimer = null;
    capture?.stop();
    capture = null;
    queue = [];
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
      socket = null;
    }
  }

  function fail(kind: SttErrorKind, message: string) {
    if (phase === "closed") return;
    teardown();
    emit({ type: "error", kind, message });
  }

  function onChunk(pcm: ArrayBuffer) {
    if (phase === "closed" || phase === "finalizing") return;
    if (socket && socket.readyState === SOCKET_OPEN) {
      socket.send(pcm);
    } else if (queue.length < MAX_QUEUED_CHUNKS) {
      queue.push(pcm);
    }
  }

  function sendFinalize() {
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    for (const pcm of queue) socket.send(pcm);
    queue = [];
    phase = "finalizing";
    emit({ type: "processing" });
    socket.send("finalize");
    finalizeTimer = deps.setTimer(
      () => fail("timeout", "Speech recognition took too long to respond. Please try again or type your request."),
      FINALIZE_TIMEOUT_MS,
    );
  }

  function handleMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let msg: { type?: string; text?: unknown; is_final?: unknown; message?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "transcript" && typeof msg.text === "string") {
      if (msg.is_final === true) {
        finalText += msg.text;
        emit({ type: "partial", text: finalText });
      } else {
        emit({ type: "partial", text: finalText + msg.text });
      }
    } else if (msg.type === "flush_done" && phase === "finalizing") {
      const text = finalText.trim();
      try {
        socket?.send("close");
      } catch {
        // socket may already be closing; transcript is complete either way
      }
      teardown();
      emit(text ? { type: "final", text } : { type: "empty" });
    } else if (msg.type === "error") {
      const detail = typeof msg.message === "string" ? ` (${msg.message})` : "";
      fail("stt_error", `Cartesia speech recognition reported an error${detail}.`);
    }
  }

  async function start() {
    let token: string;
    try {
      const [cap, tok] = await Promise.all([
        deps.startCapture(onChunk).catch((err) => {
          throw { micError: err };
        }),
        deps.fetchToken(abort.signal),
      ]);
      capture = cap;
      token = tok;
    } catch (err) {
      if (phase === "closed") return;
      if (err && typeof err === "object" && "micError" in err) {
        const { kind, message } = describeMicError(err.micError);
        fail(kind, message);
      } else {
        const message = err instanceof Error && err.message ? err.message : "Voice input is unavailable right now.";
        fail("unavailable", `${message} You can type your request instead.`);
      }
      return;
    }
    // cancelled while the mic/token were pending
    if (phase === "closed") {
      capture?.stop();
      capture = null;
      return;
    }
    emit({ type: "mic_granted" });

    try {
      socket = deps.openSocket(buildSttUrl(token));
    } catch {
      fail("network", "Couldn't connect to Cartesia speech recognition. You can type your request instead.");
      return;
    }
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (phase !== "starting") return;
      phase = "streaming";
      for (const pcm of queue) socket?.send(pcm);
      queue = [];
      if (stopRequested) {
        capture?.stop();
        capture = null;
        sendFinalize();
      } else {
        emit({ type: "listening" });
      }
    };
    socket.onmessage = (ev) => handleMessage(ev.data);
    socket.onerror = () => {
      fail("network", "Lost connection to Cartesia speech recognition. You can type your request instead.");
    };
    socket.onclose = () => {
      fail("network", "Cartesia speech recognition closed the connection early. Please try again or type your request.");
    };
    maxTimer = deps.setTimer(() => stop(), MAX_LISTEN_MS);
  }

  // user pressed stop: release the mic right away, then ask for the final transcript
  function stop() {
    if (phase === "closed" || phase === "finalizing" || stopRequested) return;
    stopRequested = true;
    if (maxTimer !== null) deps.clearTimer(maxTimer);
    maxTimer = null;
    if (phase === "streaming") {
      capture?.stop();
      capture = null;
      sendFinalize();
    } else {
      // still connecting; audio already captured is queued and finalized once open
      capture?.stop();
      capture = null;
      emit({ type: "processing" });
    }
  }

  // drop everything without emitting a transcript (unmount, disabled, new session)
  function cancel() {
    if (phase === "closed") return;
    teardown();
  }

  void start();
  return { stop, cancel };
}

export type SttSession = ReturnType<typeof createSttSession>;
