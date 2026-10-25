// bubble only while this tab is holding the shortcut, or for a few seconds after that hold.
(function () {
  const VERSION = 9;
  if (window.__tellrContentVersion === VERSION) return;
  window.__tellrAbort?.abort();
  window.__tellrAbort = new AbortController();
  window.__tellrContentVersion = VERSION;
  document.getElementById("tellr-root")?.remove();

  const signal = window.__tellrAbort.signal;
  const DEFAULT_HOLD = { code: "Space", alt: true, ctrl: false, meta: false, shift: false };
  let holdKey = DEFAULT_HOLD;
  let holding = false;
  let phase = "hidden";
  let hideTimer = null;
  let pingTimer = null;
  let port = null;

  signal.addEventListener("abort", () => {
    try {
      port?.disconnect();
    } catch {
      // already closed
    }
    port = null;
  });

  const root = document.createElement("div");
  root.id = "tellr-root";
  root.dataset.state = "hidden";
  root.innerHTML =
    '<div id="tellr-bubble" role="status" aria-live="polite" aria-atomic="true">' +
    '<div id="tellr-bars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>' +
    '<div id="tellr-copy"><span id="tellr-label">Tellr</span><span id="tellr-text"></span></div>' +
    "</div>";
  document.documentElement.appendChild(root);
  const label = root.querySelector("#tellr-label");
  const textEl = root.querySelector("#tellr-text");

  chrome.storage.local.get("holdKey", (stored) => {
    if (stored.holdKey?.code) holdKey = stored.holdKey;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.holdKey?.newValue?.code) holdKey = changes.holdKey.newValue;
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "session") render(message.session);
  });

  function matchesHold(event) {
    return (
      event.code === holdKey.code &&
      event.altKey === !!holdKey.alt &&
      event.ctrlKey === !!holdKey.ctrl &&
      event.metaKey === !!holdKey.meta &&
      event.shiftKey === !!holdKey.shift
    );
  }

  function typingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function show(state, title, body) {
    clearTimeout(hideTimer);
    phase = state === "hidden" ? "hidden" : state;
    root.dataset.state = state;
    label.textContent = title;
    textEl.textContent = body;
  }

  function hideSoon(ms = 6000) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => show("hidden", "", ""), ms);
  }

  function livePort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: "hold" });
    } catch {
      show("answer", "Tellr", "Reload the Tellr extension, then refresh this page.");
      hideSoon(8000);
      return null;
    }
    port.onMessage.addListener((message) => {
      if (message?.type === "session" && message.session) render(message.session);
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!holding) return;
      try {
        livePort()?.postMessage({ type: "ping" });
      } catch {
        port = null;
      }
    }, 400);
  }

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || holding || typingTarget(event.target) || !matchesHold(event)) return;
      event.preventDefault();
      event.stopPropagation();
      holding = true;
      show("listening", "Listening", "Speak now");
      startPing();
      try {
        livePort()?.postMessage({ type: "start" });
      } catch {
        port = null;
        show("answer", "Tellr", "Reload the Tellr extension, then refresh this page.");
        hideSoon(8000);
      }
    },
    { capture: true, signal },
  );

  function releaseHold() {
    if (!holding) return;
    holding = false;
    stopPing();
    show("processing", "Working", textEl.textContent && textEl.textContent !== "Speak now" && textEl.textContent !== "Hearing you" ? textEl.textContent : "One moment");
    try {
      port?.postMessage({ type: "stop" });
    } catch {
      chrome.runtime.sendMessage({ type: "talk-stop" }).catch(() => {});
    }
    const watch = setInterval(() => {
      chrome.runtime.sendMessage({ type: "get-session" }, (response) => {
        if (response?.session) render(response.session);
      });
    }, 400);
    hideSoon(20000);
    setTimeout(() => clearInterval(watch), 20000);
  }

  window.addEventListener(
    "keyup",
    (event) => {
      if (!holding) return;
      if (event.code !== holdKey.code) return;
      event.preventDefault();
      releaseHold();
    },
    { capture: true, signal },
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) releaseHold();
    },
    { signal },
  );

  function render(session) {
    if (!holding && phase === "hidden") return;
    const status = session?.voice?.status || "idle";
    const transcript = session?.voice?.transcript || "";
    const notice = session?.notice || "";
    const answer = session?.lastAnswer || "";
    if (holding && status === "idle" && (notice || answer)) {
      show("answer", "Tellr", notice || answer);
      hideSoon(8000);
      return;
    }
    if (holding && (status === "listening" || status === "processing")) {
      const heard = (session?.voice?.level || 0) > 0.02;
      show("listening", "Listening", transcript || (heard ? "Hearing you" : "Speak now"));
      return;
    }
    if (!holding && status === "processing") {
      show("processing", "Working", transcript || "One moment");
      return;
    }
    if (!holding && status === "speaking") {
      show("speaking", "Tellr", answer || "Speaking");
      return;
    }
    if (!holding && (notice || answer)) {
      show("answer", "Tellr", notice || answer);
      hideSoon(6000);
    }
  }
})();