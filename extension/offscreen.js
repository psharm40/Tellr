// mic capture, cartesia ink, and spoken playback. no backend keys here.
import { fetchVoiceToken } from "./lib/api.js";
import { createTalkGate } from "./lib/talkGate.js";
import { createSttSession, startMicCapture } from "./lib/stt.js";
// offscreen documents only get chrome.runtime, not chrome.storage, so settings can't be read
// here. the service worker resolves the server address and sends it with offscreen-start.

const gate = createTalkGate();
let playback = null;
let port = null;

// short tones so someone who can't see the screen knows when the mic is live
let toneCtx = null;
function tone(freqs, peak = 0.18) {
  try {
    toneCtx ??= new AudioContext();
    if (toneCtx.state === "suspended") void toneCtx.resume();
    let at = toneCtx.currentTime + 0.01;
    for (const freq of freqs) {
      const osc = toneCtx.createOscillator();
      const gain = toneCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      osc.connect(gain).connect(toneCtx.destination);
      osc.start(at);
      osc.stop(at + 0.12);
      at += 0.09;
    }
  } catch {
    // no audio device; the visual bubble still shows the state
  }
}
// each sound means one thing, with its own shape, so the state can be told apart by ear:
const MIC_ON = [660, 990]; // rising: recording now
const MIC_OFF = [990, 660]; // falling: stopped, working on it
const MIC_ERROR = [330, 247]; // low: something went wrong
const POWER_ON = [440, 660, 880]; // three rising: tellr turned on
const POWER_OFF = [880, 660, 440]; // three falling: tellr turned off
const YOUR_TURN = [1175]; // one bright note: finished talking, ready for you
const PAUSED = [392, 330]; // two soft low notes: paused, still remembering
const NAMED_TONES = { on: POWER_ON, off: POWER_OFF, error: MIC_ERROR, turn: YOUR_TURN, paused: PAUSED };
// the thinking pulse: two quick low notes, like a heartbeat, at about half the volume of the
// other tones, every 2 seconds. the first waits a moment, so quick answers make no pulse at all.
const THINKING = [294, 247];
const THINKING_VOLUME = 0.09;

let workingTimer = null;
function setWorking(on) {
  clearTimeout(workingTimer);
  clearInterval(workingTimer);
  workingTimer = null;
  if (!on) return;
  workingTimer = setTimeout(() => {
    tone(THINKING, THINKING_VOLUME);
    workingTimer = setInterval(() => tone(THINKING, THINKING_VOLUME), 2000);
  }, 900);
}

function emit(gen, event) {
  if (event?.type === "mic_granted") tone(MIC_ON);
  else if (event?.type === "processing") tone(MIC_OFF);
  else if (event?.type === "error") tone(MIC_ERROR);
  try {
    port?.postMessage({ type: "stt-event", event, gen });
  } catch {
    // the service worker will reconnect
  }
}

function handleCommand(message) {
  if (message?.type === "offscreen-start") {
    try {
      playback?.pause();
    } catch {
      // nothing playing
    }
    const gen = message.gen;
    const backendUrl = message.backendUrl;
    gate.start(gen, () =>
      createSttSession(
        {
          fetchToken: async () => fetchVoiceToken(backendUrl),
          startCapture: (onChunk) => startMicCapture(onChunk, (level) => emit(gen, { type: "level", level })),
        },
        (event) => emit(gen, event),
      ),
    );
  }
  if (message?.type === "offscreen-stop") gate.stop(message.gen);
  if (message?.type === "offscreen-kill") gate.clear();
  if (message?.type === "offscreen-speak") void play(message.audioBase64);
  if (message?.type === "offscreen-working") setWorking(Boolean(message.on));
  if (message?.type === "offscreen-tone" && NAMED_TONES[message.name]) tone(NAMED_TONES[message.name]);
  if (message?.type === "offscreen-stop-speech") stopPlayback();
}

function stopPlayback() {
  const current = playback;
  playback = null;
  if (!current) return;
  try {
    current.pause();
  } catch {
    // already stopped
  }
  // pausing doesn't fire onended, so run the cleanup it would have done
  current.onerror?.();
}

function connect() {
  try {
    port = chrome.runtime.connect({ name: "audio" });
  } catch {
    setTimeout(connect, 300);
    return;
  }
  port.onMessage.addListener(handleCommand);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 300);
  });
}

connect();

function speakDone() {
  try {
    port?.postMessage({ type: "offscreen-speak-done" });
  } catch {
    // playback already finished
  }
}

async function play(audioBase64) {
  setWorking(false);
  try {
    playback?.pause();
  } catch {
    // nothing playing
  }
  if (!audioBase64) {
    speakDone();
    return;
  }
  const bytes = Uint8Array.from(atob(audioBase64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  playback = new Audio(url);
  playback.onended = playback.onerror = () => {
    URL.revokeObjectURL(url);
    speakDone();
  };
  try {
    await playback.play();
    // the service worker paces the live caption to the audio's length
    port?.postMessage({ type: "offscreen-playing", durationSec: playback?.duration });
  } catch {
    speakDone();
  }
}
