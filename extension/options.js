import {
  DEFAULT_BACKEND,
  formatHoldKey,
  getSettings,
  holdKeyProblem,
  isModifierCode,
  normalizeBackend,
} from "./lib/settings.js";

const $ = (id) => document.getElementById(id);
const live = $("live");
const mac = navigator.platform.toUpperCase().includes("MAC");
let pendingHold = null;

getSettings().then((settings) => {
  $("backend").value = settings.backendUrl;
  $("speak").checked = settings.speakAnswers;
  pendingHold = settings.holdKey;
  $("shortcut").textContent = formatHoldKey(settings.holdKey, mac);
});

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const backendUrl = normalizeBackend($("backend").value);
  if (!backendUrl) {
    live.textContent = "Enter an http or https server address, with no path.";
    return;
  }
  const holdKey = pendingHold;
  const problem = holdKeyProblem(holdKey);
  if (problem) {
    live.textContent = problem;
    return;
  }
  await chrome.storage.local.set({ backendUrl, holdKey, speakAnswers: $("speak").checked });
  live.textContent = "Saved.";
});

$("capture").addEventListener("click", () => {
  $("capture").textContent = "Press the keys now";
  live.textContent = "Hold the modifier and the key you want.";
});

$("capture").addEventListener("keydown", (event) => {
  event.preventDefault();
  if (isModifierCode(event.code)) return;
  const hold = { code: event.code, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey };
  const problem = holdKeyProblem(hold);
  if (problem) {
    live.textContent = problem;
    return;
  }
  pendingHold = hold;
  $("shortcut").textContent = formatHoldKey(hold, mac);
  $("capture").textContent = "Press a shortcut";
  live.textContent = `Shortcut set to ${formatHoldKey(hold, mac)}. Save to keep it.`;
});

$("find-server").addEventListener("click", async () => {
  live.textContent = "Looking for a local Tellr server…";
  const candidates = ["http://localhost:3001", "http://localhost:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3000"];
  for (const origin of candidates) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "probe-backend", origin });
      if (response?.ok && response.found) {
        $("backend").value = origin;
        live.textContent = `Found Tellr at ${origin}. Save to keep it.`;
        return;
      }
    } catch {
      // try the next port
    }
  }
  live.textContent = "No Tellr API on ports 3000 or 3001. In the tellr repo, run npm run dev, then try again.";
});

$("mic").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    $("mic-status").textContent = "Microphone allowed.";
    live.textContent = "Microphone allowed. It is only on while you hold the shortcut.";
  } catch (error) {
    $("mic-status").textContent = "Microphone blocked. Typing still works.";
    live.textContent = error?.name === "NotAllowedError" ? "Chrome blocked the microphone. Allow it for this extension, then try again." : "No microphone found.";
  }
});

$("backend").placeholder = DEFAULT_BACKEND;
