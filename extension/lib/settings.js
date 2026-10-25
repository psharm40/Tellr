// settings shared by the service worker, side panel, and options page
import { probeTellrBackend } from "./api.js";

export const DEFAULT_BACKEND = "http://localhost:3000";
export const DEFAULT_HOLD_KEY = { code: "Space", alt: true, ctrl: false, meta: false, shift: false };
const LOCAL_CANDIDATES = ["http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:3000", "http://127.0.0.1:3000"];

let resolvedBackend = null;

// the saved address is often the wrong local app. probe once and remember a server that answers.
export async function getBackendUrl() {
  if (resolvedBackend) return resolvedBackend;
  const settings = await getSettings();
  const candidates = [settings.backendUrl, ...LOCAL_CANDIDATES];
  const seen = new Set();
  for (const origin of candidates) {
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    if (await probeTellrBackend(origin)) {
      resolvedBackend = origin;
      if (origin !== settings.backendUrl) await chrome.storage.local.set({ backendUrl: origin });
      return origin;
    }
  }
  return settings.backendUrl;
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(["backendUrl", "holdKey", "speakAnswers"]);
  return {
    backendUrl: normalizeBackend(stored.backendUrl) ?? DEFAULT_BACKEND,
    holdKey: normalizeHoldKey(stored.holdKey),
    speakAnswers: stored.speakAnswers !== false,
  };
}

// only http(s) origins; trailing slashes and paths are dropped
export function normalizeBackend(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const MODIFIER_CODES = new Set([
  "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight", "CapsLock", "Fn",
]);

const BLOCKED = [
  { meta: true, codes: ["KeyQ", "KeyW", "KeyT", "KeyN", "KeyR", "KeyL", "KeyH", "KeyM", "Tab"] },
  { ctrl: true, codes: ["KeyW", "KeyT", "KeyN", "KeyR", "KeyL", "Tab"] },
];

export function isModifierCode(code) {
  return MODIFIER_CODES.has(code);
}

// keys macOS or VoiceOver already own. a blind user must never have tellr and the system
// fight over the same key, or it's unclear who is listening.
const SYSTEM_CONFLICTS = [
  { when: (h) => h.meta && h.code === "Space", why: "Command+Space opens Spotlight and Siri. Pick another key." },
  { when: (h) => h.ctrl && h.alt, why: "Control+Option is the VoiceOver key. Pick another key." },
  { when: (h) => h.ctrl && h.code === "Space", why: "Control+Space switches keyboard languages on Mac. Pick another key." },
  { when: (h) => h.meta && h.code === "F5", why: "Command+F5 turns VoiceOver on and off. Pick another key." },
  { when: (h) => h.alt && h.shift && (h.code === "KeyL" || h.code === "KeyT"), why: "Tellr already uses that for its toggle and side panel shortcuts." },
  {
    when: (h) => h.alt && h.shift && ["KeyS", "KeyX", "KeyR", "KeyH", "KeyW", "KeyK", "KeyB", "KeyN", "KeyC", "KeyP"].includes(h.code),
    why: "Tellr already uses Option+Shift and that letter for one of its keyboard shortcuts. Pick another key.",
  },
];

export function holdKeyProblem(hold) {
  if (!hold.code || isModifierCode(hold.code)) return "Press a key together with the modifier.";
  const conflict = SYSTEM_CONFLICTS.find((rule) => rule.when(hold));
  if (conflict) return conflict.why;
  const fKey = /^F\d{1,2}$/.test(hold.code);
  if (!fKey && !hold.alt && !hold.ctrl && !hold.meta) return "Use Option, Control, or Command with the key, or use an F key.";
  for (const rule of BLOCKED) {
    if (((rule.meta && hold.meta) || (rule.ctrl && hold.ctrl)) && rule.codes.includes(hold.code)) {
      return "Chrome already uses that shortcut. Pick another.";
    }
  }
  return null;
}

export function normalizeHoldKey(value) {
  const raw = value ?? {};
  if (typeof raw.code !== "string" || !raw.code) return DEFAULT_HOLD_KEY;
  const hold = { code: raw.code, alt: !!raw.alt, ctrl: !!raw.ctrl, meta: !!raw.meta, shift: !!raw.shift };
  return holdKeyProblem(hold) ? DEFAULT_HOLD_KEY : hold;
}

function keyName(code) {
  if (code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

export function formatHoldKey(hold, mac) {
  if (mac) {
    const mods = `${hold.ctrl ? "⌃" : ""}${hold.alt ? "⌥" : ""}${hold.shift ? "⇧" : ""}${hold.meta ? "⌘" : ""}`;
    return `${mods}${mods ? " " : ""}${keyName(hold.code)}`;
  }
  return [hold.ctrl && "Ctrl", hold.alt && "Alt", hold.shift && "Shift", hold.meta && "Win", keyName(hold.code)]
    .filter(Boolean)
    .join(" + ");
}
