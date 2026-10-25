// cartesia ink push-to-talk, copied for the offscreen document.
// protocol: raw pcm in, "finalize" on stop, join is_final chunks, wait for flush_done.
export const STT_SAMPLE_RATE = 16000;
export const STT_SOCKET_BASE = "wss://api.cartesia.ai/stt/websocket";
export const CARTESIA_VERSION = "2026-08-14";
const MAX_LISTEN_MS = 12_000;
const FINALIZE_TIMEOUT_MS = 6_000;
const CONNECT_TIMEOUT_MS = 4_000;
const MAX_QUEUED_CHUNKS = 100;

export function buildSttUrl(accessToken) {
  const params = new URLSearchParams({
    model: "ink-2",
    encoding: "pcm_s16le",
    sample_rate: String(STT_SAMPLE_RATE),
    cartesia_version: CARTESIA_VERSION,
    access_token: accessToken,
  });
  return `${STT_SOCKET_BASE}?${params.toString()}`;
}

export function createPcmChunker(inputSampleRate, onChunk, targetSampleRate = STT_SAMPLE_RATE, chunkMs = 100) {
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
    push(samples) {
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

export function describeMicError(err) {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Open Tellr settings, allow the microphone, then try again. You can also type.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. You can type your request instead.";
  }
  return "The microphone couldn't be started. You can type your request instead.";
}

function wsText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return "";
}

export function createSttSession(opts, emit) {
  const { startCapture } = opts;
  let phase = "starting";
  let stopRequested = false;
  let socket = null;
  let capture = null;
  let queue = [];
  let finalText = "";
  let maxTimer = null;
  let finalizeTimer = null;
  let connectTimer = null;

  function teardown() {
    phase = "closed";
    if (maxTimer !== null) clearTimeout(maxTimer);
    if (finalizeTimer !== null) clearTimeout(finalizeTimer);
    if (connectTimer !== null) clearTimeout(connectTimer);
    maxTimer = finalizeTimer = connectTimer = null;
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

  function fail(message) {
    if (phase === "closed") return;
    teardown();
    emit({ type: "error", message });
  }

  function onChunk(pcm) {
    if (phase === "closed" || phase === "finalizing") return;
    if (socket && socket.readyState === 1) socket.send(pcm);
    else if (queue.length < MAX_QUEUED_CHUNKS) queue.push(pcm);
  }

  function finish() {
    const text = finalText.trim();
    try {
      socket?.send("close");
    } catch {
      // transcript is complete either way
    }
    teardown();
    emit(text ? { type: "final", text } : { type: "empty" });
  }

  function sendFinalize() {
    if (finalizeTimer !== null) clearTimeout(finalizeTimer);
    finalizeTimer = null;
    if (!socket || socket.readyState !== 1) {
      finish();
      return;
    }
    for (const pcm of queue) socket.send(pcm);
    queue = [];
    phase = "finalizing";
    emit({ type: "processing" });
    try {
      socket.send("finalize");
    } catch {
      finish();
      return;
    }
    finalizeTimer = setTimeout(() => {
      if (phase === "finalizing") finish();
    }, FINALIZE_TIMEOUT_MS);
  }

  function handleMessage(raw) {
    if (typeof raw !== "string") return;
    let msg;
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
      finish();
    } else if (msg.type === "error") {
      const detail = typeof msg.message === "string" ? ` (${msg.message})` : "";
      fail(`Speech recognition reported an error${detail}.`);
    }
  }

  async function start() {
    let token = opts.token;
    try {
      const pending = [startCapture(onChunk)];
      if (!token && opts.fetchToken) pending.push(opts.fetchToken());
      const started = await Promise.all(pending);
      capture = started[0];
      if (!token) token = started[1];
    } catch (err) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "NotFoundError" || name === "NotSupportedError" || name === "SecurityError") {
        fail(describeMicError(err));
      } else {
        fail(err?.message || "Voice didn't start. You can type instead.");
      }
      return;
    }
    if (phase === "closed") {
      capture?.stop();
      capture = null;
      return;
    }
    if (stopRequested) {
      capture?.stop();
      capture = null;
    }
    emit({ type: "mic_granted" });

    try {
      socket = new WebSocket(buildSttUrl(token));
    } catch {
      fail("Couldn't connect to speech recognition. You can type instead.");
      return;
    }
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (phase === "closed") return;
      if (connectTimer !== null) clearTimeout(connectTimer);
      connectTimer = null;
      if (phase === "starting") phase = "streaming";
      for (const pcm of queue) socket.send(pcm);
      queue = [];
      if (stopRequested) {
        capture?.stop();
        capture = null;
        sendFinalize();
      } else {
        emit({ type: "listening" });
      }
    };
    socket.onmessage = (ev) => handleMessage(wsText(ev.data));
    socket.onerror = () => fail("Lost connection to speech recognition. You can type instead.");
    socket.onclose = () => {
      if (phase === "finalizing") {
        finish();
        return;
      }
      if (phase !== "closed") fail("Speech recognition closed the connection early. Please try again or type.");
    };
    maxTimer = setTimeout(() => stop(), MAX_LISTEN_MS);
    connectTimer = setTimeout(() => {
      if (phase === "starting") {
        if (stopRequested) finish();
        else fail("Speech recognition did not connect. Please try again or type.");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function stop() {
    if (phase === "closed" || phase === "finalizing" || stopRequested) return;
    stopRequested = true;
    if (maxTimer !== null) clearTimeout(maxTimer);
    maxTimer = null;
    capture?.stop();
    capture = null;
    if (phase === "streaming") sendFinalize();
    else emit({ type: "processing" });
  }

  function cancel() {
    if (phase === "closed") return;
    teardown();
  }

  void start();
  return { stop, cancel };
}

function peakLevel(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 16) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

function samplesFromAudioData(audioData) {
  const frames = audioData.numberOfFrames;
  const planar = new Float32Array(frames);
  try {
    audioData.copyTo(planar, { planeIndex: 0, format: "f32-planar" });
    return planar;
  } catch {
    const interleaved = new Float32Array(frames * Math.max(1, audioData.numberOfChannels));
    audioData.copyTo(interleaved, { planeIndex: 0, format: "f32" });
    return interleaved.subarray(0, frames);
  }
}

function reportLevel(samples, onLevel, state) {
  const level = peakLevel(samples);
  if (!onLevel) return;
  if (level <= 0.02 && state.last <= 0.02) return;
  state.last = level;
  onLevel(level);
}

async function captureFromWorklet(stream, onChunk, onLevel) {
  const context = new AudioContext();
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state === "suspended") throw new Error("audio context suspended");
    await context.audioWorklet.addModule(chrome.runtime.getURL("pcm-tap.js"));
    const source = context.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(context, "tellr-pcm-tap");
    const chunker = createPcmChunker(context.sampleRate, onChunk);
    const levels = { last: 0 };
    tap.port.onmessage = (event) => {
      const samples = event.data;
      if (!samples) return;
      chunker.push(samples);
      reportLevel(samples, onLevel, levels);
    };
    source.connect(tap);
    tap.connect(context.destination);
    return {
      stop() {
        tap.port.onmessage = null;
        chunker.flush();
        try {
          source.disconnect();
          tap.disconnect();
        } catch {
          // already disconnected
        }
        stream.getTracks().forEach((item) => item.stop());
        void context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

// reads the mic track itself. a muted audiocontext graph stops delivering samples.
async function captureFromTrack(stream, onChunk, onLevel) {
  const track = stream.getAudioTracks()[0];
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  let chunker = null;
  let rate = 0;
  let stopped = false;
  const levels = { last: 0 };
  const pump = (async () => {
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const samples = samplesFromAudioData(value);
      const sampleRate = value.sampleRate || track.getSettings().sampleRate || 48000;
      value.close();
      if (!chunker || rate !== sampleRate) {
        rate = sampleRate;
        chunker = createPcmChunker(sampleRate, onChunk);
      }
      chunker.push(samples);
      reportLevel(samples, onLevel, levels);
    }
  })();
  pump.catch(() => {});
  return {
    stop() {
      stopped = true;
      chunker?.flush();
      reader.cancel().catch(() => {});
      stream.getTracks().forEach((item) => item.stop());
    },
  };
}

async function captureFromGraph(stream, onChunk, onLevel) {
  const context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunker = createPcmChunker(context.sampleRate, onChunk);
  const levels = { last: 0 };
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    chunker.push(samples);
    reportLevel(samples, onLevel, levels);
  };
  source.connect(processor);
  processor.connect(context.destination);
  return {
    stop() {
      chunker.flush();
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((item) => item.stop());
      void context.close();
    },
  };
}

export async function startMicCapture(onChunk, onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
  });
  const blocked = (error) => error?.name === "NotAllowedError" || error?.name === "NotFoundError" || error?.name === "SecurityError";
  if (typeof AudioWorkletNode === "function" && chrome.runtime?.getURL) {
    try {
      return await captureFromWorklet(stream, onChunk, onLevel);
    } catch (error) {
      if (blocked(error)) throw error;
    }
  }
  if (typeof MediaStreamTrackProcessor === "function") {
    try {
      return await captureFromTrack(stream, onChunk, onLevel);
    } catch (error) {
      if (blocked(error)) throw error;
    }
  }
  return captureFromGraph(stream, onChunk, onLevel);
}
