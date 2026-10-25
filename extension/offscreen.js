// mic capture, cartesia ink, and spoken playback. no backend keys here.
import { fetchVoiceToken } from "./lib/api.js";
import { createTalkGate } from "./lib/talkGate.js";
import { getBackendUrl } from "./lib/settings.js";
import { createSttSession, startMicCapture } from "./lib/stt.js";

const gate = createTalkGate();
let playback = null;
let port = null;

function emit(gen, event) {
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
    gate.start(gen, () =>
      createSttSession(
        {
          fetchToken: async () => fetchVoiceToken(await getBackendUrl()),
          startCapture: (onChunk) => startMicCapture(onChunk, (level) => emit(gen, { type: "level", level })),
        },
        (event) => emit(gen, event),
      ),
    );
  }
  if (message?.type === "offscreen-stop") gate.stop(message.gen);
  if (message?.type === "offscreen-kill") gate.clear();
  if (message?.type === "offscreen-speak") void play(message.audioBase64);
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
  } catch {
    speakDone();
  }
}
