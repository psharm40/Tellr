// bubble only while this tab is holding the shortcut, or for a few seconds after that hold.
(function () {
  const VERSION = 18;
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
  const bubble = root.querySelector("#tellr-bubble");

  // when answers are spoken aloud, a live region would make screen readers read them a second time
  function applySpeakAnswers(speakOn) {
    if (speakOn) {
      bubble.removeAttribute("role");
      bubble.setAttribute("aria-live", "off");
    } else {
      bubble.setAttribute("role", "status");
      bubble.setAttribute("aria-live", "polite");
    }
  }

  chrome.storage.local.get(["holdKey", "speakAnswers"], (stored) => {
    if (stored.holdKey?.code) holdKey = stored.holdKey;
    applySpeakAnswers(stored.speakAnswers !== false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.holdKey?.newValue?.code) holdKey = changes.holdKey.newValue;
    if (changes.speakAnswers) applySpeakAnswers(changes.speakAnswers.newValue !== false);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "session") render(message.session);
    if (message?.type === "caption") startCaption(message.text, message.durationMs);
    if (message?.type === "caption-end") endCaption();
    if (message?.type === "label-results") labelResults(message.items || []);
    if (message?.type === "highlight") highlight(message);
    if (message?.type === "find-action") sendResponse(moveToAction());
    if (message?.type === "clear-marks") clearMarks();
  });

  // --- taking the shopper to the buy or checkout button. tellr NEVER clicks it: it scrolls to
  // it, makes it glow, and moves keyboard and screen reader focus onto it, so the shopper
  // presses it themselves. on a cart page that's checkout; otherwise the reversible
  // "add to cart" first, then "buy it now".
  const ACTIONS = [
    /\b(proceed to checkout|go to checkout|continue to checkout|^\s*check ?out\s*$)/i,
    /\badd to (shopping )?(cart|bag|basket)\b/i,
    /\bbuy (it )?now\b/i,
  ];

  function actionLabel(el) {
    return (el.getAttribute("aria-label") || el.innerText || el.value || "").replace(/\s+/g, " ").trim();
  }

  function visible(el) {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function moveToAction() {
    const controls = [...document.querySelectorAll("button, a[href], input[type='submit'], input[type='button'], [role='button']")]
      .filter((el) => !el.closest("#tellr-root") && visible(el))
      .map((el) => ({ el, label: actionLabel(el) }))
      .filter(({ label }) => label && label.length < 60);
    for (const pattern of ACTIONS) {
      const match = controls.find(({ label }) => pattern.test(label));
      if (!match) continue;
      boxAround([match.el]);
      if (!match.el.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT)$/.test(match.el.tagName)) match.el.setAttribute("tabindex", "-1");
      match.el.focus({ preventScroll: true });
      return { label: match.label };
    }
    return { label: null };
  }

  // --- showing on the page which item tellr is talking about ---
  // boxes and numbers are drawn in tellr's own layer on top of the page, positioned over each
  // result card, so the site's styles can't clip or override them. items are found by their
  // listing link, so this works on any ebay or amazon layout.
  const ITEM_ID = /\/(?:itm|dp|gp\/product)\/(?:[^/?#]*\/)?([A-Za-z0-9]{6,})/;

  function itemId(url) {
    return String(url || "").match(ITEM_ID)?.[1] || null;
  }

  // the whole result card for a listing: start at its link and grow outward until the next
  // level up would also contain links to other items
  function cardFor(url) {
    const id = itemId(url);
    if (!id) return null;
    const link = [...document.querySelectorAll("a[href]")].find((a) => itemId(a.href) === id && a.getClientRects().length);
    if (!link) return null;
    let card = link;
    while (card.parentElement && card.parentElement !== document.body && card.parentElement !== document.documentElement) {
      const ids = new Set([...card.parentElement.querySelectorAll("a[href]")].map((a) => itemId(a.href)).filter(Boolean));
      if (ids.size > 1) break;
      card = card.parentElement;
    }
    return card;
  }

  // on an item's own page: its main photo
  function mainPhoto() {
    const candidates = [...document.querySelectorAll("main img, #main img, [role='main'] img, img")].filter(
      (img) => !img.closest("#tellr-root") && !img.closest("a[href]")?.href?.match(ITEM_ID) && img.getBoundingClientRect().width > 150,
    );
    candidates.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
    const img = candidates[0];
    return img ? img.closest("figure, [class*='carousel'], [class*='gallery'], [class*='image']") || img : null;
  }

  const layer = document.createElement("div");
  layer.id = "tellr-marks";
  // visual only: screen reader users already hear the numbers and the item from tellr
  layer.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(layer);
  const badges = new Map(); // card element -> number
  let boxed = []; // elements with a box around them
  let placeTimer = null;

  function place() {
    layer.textContent = "";
    const sx = window.scrollX;
    const sy = window.scrollY;
    for (const el of boxed) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const box = document.createElement("div");
      box.className = "tellr-box";
      box.style.left = `${r.left + sx - 8}px`;
      box.style.top = `${r.top + sy - 8}px`;
      box.style.width = `${r.width + 16}px`;
      box.style.height = `${r.height + 16}px`;
      layer.appendChild(box);
    }
    for (const [el, number] of badges) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const badge = document.createElement("div");
      badge.className = "tellr-badge";
      badge.textContent = String(number);
      badge.style.left = `${r.left + sx - 4}px`;
      badge.style.top = `${r.top + sy - 4}px`;
      layer.appendChild(badge);
    }
  }

  let placing = false;
  function schedulePlace() {
    if (placing) return;
    placing = true;
    requestAnimationFrame(() => {
      placing = false;
      place();
    });
  }
  window.addEventListener("scroll", schedulePlace, { passive: true, signal });
  window.addEventListener("resize", schedulePlace, { signal });

  // pages shift as images load, so keep the marks aligned while any are showing
  function keepPlaced() {
    clearInterval(placeTimer);
    placeTimer = badges.size || boxed.length ? setInterval(place, 700) : null;
    place();
  }

  function boxAround(elements) {
    boxed = elements.filter(Boolean);
    keepPlaced();
    if (boxed[0]) scrollTo(boxed[0]);
  }

  function scrollTo(el) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  function clearMarks() {
    badges.clear();
    boxed = [];
    keepPlaced();
    show("hidden", "", "");
  }

  // number badges on the listed items, matching "number 1", "number 2" in what tellr says
  function labelResults(items) {
    badges.clear();
    for (const { number, url } of items) {
      const card = cardFor(url);
      if (card) badges.set(card, number);
    }
    keepPlaced();
  }

  // box (and scroll to) the items being talked about; with page: true, the open item's photo
  function highlight({ urls = [], page = false }) {
    boxAround(page ? [mainPhoto()] : urls.map(cardFor));
  }

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

  // after tellr is reloaded or updated, this old page script can't reach it any more
  // ("extension context invalidated") until the page is refreshed
  function extensionGone() {
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }

  let staleWarned = false;
  function warnStale() {
    const message = "Tellr was updated. Refresh this page to keep using it.";
    show("answer", "Tellr", message);
    // the extension can't speak for us now, so make sure a screen reader and the shopper hear it
    bubble.setAttribute("role", "alert");
    if (!staleWarned && "speechSynthesis" in window) {
      staleWarned = true;
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
    }
    hideSoon(10000);
  }

  function livePort() {
    if (port) return port;
    if (extensionGone()) {
      warnStale();
      return null;
    }
    try {
      port = chrome.runtime.connect({ name: "hold" });
    } catch {
      show("answer", "Tellr", "Reload the Tellr extension, then refresh this page.");
      hideSoon(8000);
      return null;
    }
    port.onMessage.addListener((message) => {
      if (message?.type === "session" && message.session) render(message.session);
      if (message?.type === "caption") startCaption(message.text, message.durationMs);
      if (message?.type === "caption-end") endCaption();
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
      if (extensionGone()) {
        warnStale();
        return;
      }
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

  // option+shift + a letter on a shopping page does one tellr thing, without talking. never while
  // typing in a field, and never with control or command, so voiceover (control+option) and the
  // browser's own shortcuts keep working
  const PAGE_KEYS = { KeyR: "repeat", KeyH: "help", KeyW: "where", KeyK: "recap", KeyB: "back", KeyN: "more", KeyC: "check", KeyP: "pause" };
  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const action = PAGE_KEYS[event.code];
      if (!action || typingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (extensionGone()) {
        warnStale();
        return;
      }
      chrome.runtime.sendMessage({ type: "page-key", action }).catch(() => {});
    },
    { capture: true, signal },
  );

  function releaseHold() {
    if (!holding) return;
    holding = false;
    stopPing();
    show("processing", "Thinking", textEl.textContent && textEl.textContent !== "Speak now" && textEl.textContent !== "Hearing you" ? textEl.textContent : "One moment");
    try {
      port?.postMessage({ type: "stop" });
    } catch {
      if (!extensionGone()) chrome.runtime.sendMessage({ type: "talk-stop" }).catch(() => {});
    }
    const watch = setInterval(() => {
      if (extensionGone()) {
        clearInterval(watch);
        warnStale();
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: "get-session" }, (response) => {
          if (response?.session) render(response.session);
        });
      } catch {
        clearInterval(watch);
        warnStale();
      }
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

  // --- live caption: tellr's words appear as it says them. same pacing as lib/caption.js
  // (content scripts can't import modules). the bubble's live region is off while answers
  // are spoken, so screen readers don't read the caption over the voice.
  let caption = null;

  function captionAt(text, elapsedMs, durationMs, maxWords = 40) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const share = durationMs > 0 ? Math.min(1, Math.max(0, elapsedMs / durationMs)) : 1;
    const shown = Math.max(1, Math.ceil(words.length * share));
    const start = Math.max(0, shown - maxWords);
    return (start > 0 ? "… " : "") + words.slice(start, shown).join(" ");
  }

  function startCaption(text, durationMs) {
    // the same caption can arrive twice (port and tab message); don't restart it
    if (caption && caption.text === text && performance.now() - caption.started < 500) return;
    endCaption();
    caption = { text, durationMs, started: performance.now(), frame: 0 };
    show("speaking", "Speaking", captionAt(text, 0, durationMs));
    const tick = () => {
      if (!caption) return;
      const elapsed = performance.now() - caption.started;
      textEl.textContent = captionAt(caption.text, elapsed, caption.durationMs);
      if (elapsed < caption.durationMs) caption.frame = requestAnimationFrame(tick);
    };
    caption.frame = requestAnimationFrame(tick);
  }

  function endCaption() {
    if (!caption) return;
    cancelAnimationFrame(caption.frame);
    caption = null;
  }

  function render(session) {
    // the caption owns the bubble while tellr talks
    if (caption && session?.voice?.status === "speaking") return;
    if (!holding && phase === "hidden") return;
    const status = session?.voice?.status || "idle";
    const transcript = session?.voice?.transcript || "";
    const notice = session?.notice || "";
    const answer = session?.lastAnswer || "";
    if (holding && status === "idle" && (notice || answer)) {
      show("answer", "Your turn", notice || answer);
      hideSoon(8000);
      return;
    }
    if (holding && (status === "listening" || status === "processing")) {
      const heard = (session?.voice?.level || 0) > 0.02;
      show("listening", "Listening", transcript || (heard ? "Hearing you" : "Speak now"));
      return;
    }
    if (!holding && status === "processing") {
      show("processing", "Thinking", transcript || "One moment");
      return;
    }
    if (!holding && status === "speaking") {
      show("speaking", "Speaking", answer || "Speaking");
      return;
    }
    if (!holding && (notice || answer)) {
      show("answer", "Your turn", notice || answer);
      hideSoon(6000);
    }
  }
})();