// service worker: talks to the tellr backend. keys stay on the server.
import { ApiError, chooseItems, confirmDemoOrder, savedDelete, savedList, savedPut, describeItems, explainListing, judgeItems, fetchSpeech, inspectListing, parseRequirements, probeTellrBackend, reviewCheckout } from "./lib/api.js";
import {
  speakablePrices,
  budgetText,
  checkoutAnswer,
  descriptionPart,
  itemTotalSpeech,
  savedLine,
  shortcutsSpeech,
  shortlistSpeech,
  describeRequirement,
  firstSentence,
  requirementLabel,
  placeSpeech,
  welcomeSpeech,
  clipForSpeech,
  compareSpeech,
  factsSpeech,
  fitScore,
  formatUsd,
  helpSpeech,
  inspectionSpeech,
  nextHint,
  preferencesSpeech,
  reminderName,
} from "./lib/format.js";
import { listingImagesFromUrls, thumbnailFor } from "./lib/images.js";
import { forServer, mergeSaved, queueOp } from "./lib/saved.js";
import { NO_PREFERENCE, SIZE_KIND_NAME, SKIP_ASKING, answerFits, sizeAnswer, answersSoFar, normalizeSize, profileLine, sizeKindIn, sizeStatement, askable, basicQuestion, missingBasics, recapSpeech, topicOf } from "./lib/interview.js";
import { MAX_COMPARE, classifyIntent, isInspectCommand, parseCompareList, parseItemNumber, parseSavedNumber, parseSiteSearch } from "./lib/intent.js";
import { keywordsFrom, priceBounds, screenResults, screeningSummary } from "./lib/screen.js";
import { SITE_NAME, buildSearch, changesSearch, describeSearch, sameSearch as sameSearchAs, searchUrl, siteOf } from "./lib/search.js";
import { answerFromPage, buildCheckout, buildListing, namedProducts } from "./lib/page.js";
import { bumpCheckout, createSession, forgetStaleGoal, isItemUrl, itemKey, pushHistory, topicFromText } from "./lib/session.js";
import { formatHoldKey, getBackendUrl, getSettings } from "./lib/settings.js";

const MAX_REQUIREMENTS = 2000;
const MAX_QUESTION = 500;

let session = createSession();
// chrome stops an idle service worker after about 30s. reload the saved session so a pause
// mid-demo doesn't forget the goal. photo data isn't saved; inspect re-reads it from the page.
const ready = chrome.storage.session
  .get("session")
  .then(({ session: saved }) => {
    if (saved) session = { ...saved, busy: false, notice: null, voice: { status: "idle", transcript: "" } };
  })
  .then(() => chrome.storage.local.get("profile"))
  .then((stored) => {
    if (stored?.profile?.sizes) profile = { sizes: { ...stored.profile.sizes } };
  })
  .then(loadSaved)
  .catch(() => {});

// --- the saved list across sessions: chrome first (never lost offline), then convex ---
// owner: a random id for this chrome profile, kept in chrome's synced storage (no login yet)
let savedOwner = "";
// changes that haven't reached the server yet, oldest first
let savedPending = [];
const MAX_SAVED = 30;

async function loadSaved() {
  const synced = await chrome.storage.sync.get("tellrOwner").catch(() => ({}));
  savedOwner = synced?.tellrOwner || crypto.randomUUID();
  if (!synced?.tellrOwner) await chrome.storage.sync.set({ tellrOwner: savedOwner }).catch(() => {});
  const local = await chrome.storage.local.get(["savedItems", "savedPending"]).catch(() => ({}));
  savedPending = Array.isArray(local?.savedPending) ? local.savedPending : [];
  if (Array.isArray(local?.savedItems)) session = { ...session, shortlist: local.savedItems };
  void syncSaved();
}

function keepSavedLocally() {
  void chrome.storage.local.set({ savedItems: session.shortlist || [], savedPending }).catch(() => {});
}

// every change to the list: shown and kept in chrome right away, then sent to the server
function changeSaved(list, op) {
  session = { ...session, shortlist: list.slice(-MAX_SAVED) };
  savedPending = queueOp(savedPending, op.op === "save" ? { op: "save", item: forServer(op.item) } : op);
  keepSavedLocally();
  void syncSaved();
}

// sends waiting changes in order, then takes the server's list (with anything still waiting on
// top). offline or the server down: the chrome copy stays, and it's tried again next time.
let syncing = null;
function syncSaved() {
  syncing ??= (async () => {
    try {
      const backend = await getBackendUrl();
      while (savedPending.length) {
        const [next] = savedPending;
        if (next.op === "save") await savedPut(backend, savedOwner, next.item);
        else if (next.op === "remove") await savedDelete(backend, savedOwner, next.key);
        else await savedDelete(backend, savedOwner);
        savedPending = savedPending.slice(1);
        keepSavedLocally();
      }
      const remote = await savedList(backend, savedOwner);
      session = { ...session, shortlist: mergeSaved(remote.items || [], savedPending) };
      keepSavedLocally();
      broadcast({ type: "session", session });
    } catch {
      // stays in chrome; tried again on the next change or when tellr starts
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
// the shopper's usual size for each kind of item ({ sizes: { shoe: "8", top: "M" } }), kept in
// chrome on this computer only, across shopping sessions and after closing tellr
let profile = { sizes: {} };

function saveSize(kind, size) {
  if (!kind || !size) return;
  profile = { sizes: { ...profile.sizes, [kind]: size } };
  void chrome.storage.local.set({ profile }).catch(() => {});
}

// the kind of item being shopped for, for its usual size
function goalKind(extra = "") {
  return topicFromText(session.preferences?.category || "") || topicFromText(extra);
}
let creatingOffscreen = null;
let talkHold = false;
// the working tick is playing; when tellr last made a sound (for the "still working" nudge)
let workingSound = false;
let lastHeardAt = 0;
// "hold": the page key is held down and pings while held. "toggle": started by a button or
// the toggle shortcut and stopped the same way, so there are no pings to watch.
let holdMode = "hold";
let talkGen = 0;
let holdTabId = null;
let holdSeen = 0;
let lastLevelAt = 0;
let listenWatchdog = null;
let processWatchdog = null;
const PENDING_CONFIRM_MS = 2 * 60_000;

// hands-free listening (toggle shortcut, button, or after the welcome): the mic closes by
// itself a moment after the shopper stops talking, or if they never start
let talkStartedAt = 0;
let lastVoiceAt = 0;
const VOICE_LEVEL = 0.03;
setInterval(() => {
  if (!talkHold) return;
  const now = Date.now();
  if (holdMode === "hold" && now - holdSeen > 3000) void enqueue(() => stopTalk());
  if (holdMode === "toggle") {
    const heard = lastVoiceAt > talkStartedAt;
    if ((heard && now - lastVoiceAt > 1600) || (!heard && now - talkStartedAt > 8000)) void enqueue(() => stopTalk());
  }
}, 250);

// keyboard shortcuts from manifest "commands". these work anywhere in chrome, not just on the page.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-tellr") {
    // must run inside the shortcut's user gesture, so no await before this
    if (tab?.id != null) void chrome.sidePanel.open({ tabId: tab.id });
    return;
  }
  if (command === "toggle-listening") {
    if (tab?.id != null) holdTabId = tab.id;
    // starting tellr opens its side panel too. it has to happen right here, inside the key press:
    // chrome only opens the panel in response to a click or a shortcut, never to speech
    if (!talkHold && tab?.id != null) void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    void enqueue(() => toggleTalk());
  }
  if (command === "stop-speaking") void ready.then(() => stopSpeaking());
  if (command === "close-tellr") void ready.then(() => closeKey());
});

// option+shift + a letter on the page: the same steps as saying it
async function runPageKey(action, tabId) {
  if (tabId != null) holdTabId = tabId;
  if (session.off) return;
  if (action === "pause") {
    if (session.paused) await runAction(() => runResume());
    else await runPause();
    return;
  }
  await runAction(async () => {
    if (action === "repeat") await runRepeat();
    else if (action === "help") await runHelp();
    else if (action === "where") await finishAnswer(placeSpeech(await extractActivePage()), { hint: true });
    else if (action === "recap") await finishAnswer(recapSpeech(session.preferences, session.asked, describeRequirement, budgetText));
    else if (action === "more") await runMore();
    else if (action === "check") await runInspect();
    else if (action === "back") {
      if (session.results?.length && session.lastSearch) await runBackToList();
      else await finishAnswer("There's no list of results to go back to yet. Tell me what you're looking for.");
    }
  });
}

// option+shift+x closes, which forgets the session, so it takes two presses: one stray key
// never clears everything
const CLOSE_KEY_WINDOW_MS = 8000;
let closeKeyAt = 0;
async function closeKey() {
  if (session.off) return;
  if (Date.now() - closeKeyAt < CLOSE_KEY_WINDOW_MS) {
    closeKeyAt = 0;
    await runClose();
    return;
  }
  closeKeyAt = Date.now();
  interruptSpeech();
  const keys = await shortcutWords();
  await finishAnswer(`Press ${keys.close} again to close Tellr and clear the page, or say pause to take a break.`);
}

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) void chrome.sidePanel.open({ tabId: tab.id });
});

let chain = ready;
let audioPort = null;
let audioWaiters = [];
let holdPort = null;

void killMic();

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "audio") {
    bindAudioPort(port);
    return;
  }
  if (port.name !== "hold") return;
  const tabId = port.sender?.tab?.id ?? null;
  holdPort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "ping") {
      if (tabId == null || tabId === holdTabId) holdSeen = Date.now();
      return;
    }
    if (message?.type === "start") {
      holdTabId = tabId ?? holdTabId;
      holdSeen = Date.now();
      holdMode = "hold";
      void enqueue(() => startTalk());
      return;
    }
    if (message?.type === "stop") void enqueue(() => stopTalk());
  });
  port.onDisconnect.addListener(() => {
    if (holdPort === port) holdPort = null;
    if (talkHold && tabId != null && tabId === holdTabId) void enqueue(() => stopTalk());
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  await ready;
  switch (message?.type) {
    case "get-session":
      return { session: publicSession(session) };
    case "get-settings":
      return { settings: await getSettings() };
    case "talk-start":
      holdTabId = sender?.tab?.id ?? holdTabId;
      holdSeen = Date.now();
      holdMode = "hold";
      await enqueue(() => startTalk());
      return {};
    case "talk-toggle":
      await enqueue(() => toggleTalk());
      return {};
    case "talk-ping":
      if (sender?.tab?.id == null || sender.tab.id === holdTabId) holdSeen = Date.now();
      return {};
    case "talk-stop":
      await enqueue(() => stopTalk());
      return {};
    case "talk-cancel":
      await forceIdle();
      return {};
    case "stop-speaking":
      await stopSpeaking();
      return {};
    case "pause-now":
      await runPause();
      return {};
    case "resume-now":
      await runAction(() => runResume());
      return {};
    case "typed":
      await handleTranscript(String(message.text || ""));
      return {};
    case "stt-event":
      await onSttEvent(message.event, message.gen);
      return {};
    // side panel buttons: same steps as voice, with the same busy state and spoken errors
    case "inspect-now":
      await runAction(() => runInspect());
      return {};
    case "review-now":
      await runAction(() => runReview());
      return {};
    case "confirm-now":
      await runAction(() => runConfirm());
      return {};
    case "cancel-confirm":
      await runAction(() => runCancelConfirm());
      return {};
    case "help-now":
      await runAction(() => runHelp());
      return {};
    case "repeat-now":
      await runAction(() => runRepeat());
      return {};
    case "list-now":
      await runAction(() => runList());
      return {};
    case "more-now":
      await runAction(() => runMore());
      return {};
    case "compare-now":
      await runAction(() => runCompare([1, 2, 3]));
      return {};
    case "open-result":
      await runAction(() => runOpen(Number(message.number)));
      return {};
    case "open-saved":
      await runAction(() => runOpenSaved(`saved ${Number(message.number)}`));
      return {};
    case "remove-saved":
      await runAction(() => runUnsave(`remove saved ${Number(message.number)}`));
      return {};
    case "page-key":
      await runPageKey(message.action, sender?.tab?.id);
      return {};
    case "probe-backend":
      return { found: await probeTellrBackend(message.origin) };
    default:
      return {};
  }
}

async function killMic() {
  try {
    audioPort?.postMessage({ type: "offscreen-kill" });
  } catch {
    // offscreen is already gone
  }
}

function bindAudioPort(port) {
  audioPort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "stt-event") void onSttEvent(message.event, message.gen);
    if (message?.type === "offscreen-playing" && caption) {
      broadcast({ type: "caption", text: caption.text, durationMs: captionDuration(caption.text, message.durationSec) });
    }
    if (message?.type === "offscreen-speak-done") {
      lastHeardAt = Date.now();
      endCaption();
      speechFinished();
      setSession({ voice: { status: "idle", transcript: session.voice.transcript } });
    }
  });
  port.onDisconnect.addListener(() => {
    if (audioPort === port) audioPort = null;
  });
  const waiters = audioWaiters;
  audioWaiters = [];
  for (const waiter of waiters) waiter(port);
}

function waitForAudioPort(timeoutMs = 2500) {
  if (audioPort) return Promise.resolve(audioPort);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(audioPort), timeoutMs);
    audioWaiters.push((port) => {
      clearTimeout(timer);
      resolve(port);
    });
  });
}

async function forceIdle() {
  talkHold = false;
  talkGen += 1;
  holdSeen = 0;
  clearListenWatchdog();
  clearProcessWatchdog();
  setSession({ busy: false, notice: null, voice: { status: "idle", transcript: "" } });
  await killMic();
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
        justification: "Hold-to-talk microphone and spoken answers",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function sendOffscreen(message) {
  await ensureOffscreen();
  const port = audioPort || (await waitForAudioPort());
  if (!port) throw new Error("Tellr's microphone didn't start. Reload the extension, refresh the page, and try again.");
  port.postMessage(message);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// photo data stays in memory only: it's megabytes, and the panel and storage don't need it
function withoutPhotoData(listing) {
  if (!listing) return listing;
  return {
    ...listing,
    images: listing.images.map((image) => ({
      id: image.id,
      url: image.url.startsWith("data:") ? "" : image.url,
      alt: image.alt,
    })),
  };
}

function publicSession(current) {
  return {
    ...current,
    listing: withoutPhotoData(current.listing),
    comparisons: (current.comparisons || []).map((entry) => ({ ...entry, listing: withoutPhotoData(entry.listing) })),
  };
}

function clearListenWatchdog() {
  if (listenWatchdog !== null) clearTimeout(listenWatchdog);
  listenWatchdog = null;
}

function clearProcessWatchdog() {
  if (processWatchdog !== null) clearTimeout(processWatchdog);
  processWatchdog = null;
}

function armProcessWatchdog() {
  clearProcessWatchdog();
  processWatchdog = setTimeout(() => {
    if (session.voice.status === "processing" && !session.busy) {
      void notHeard();
    }
  }, 15_000);
}

async function startTalk() {
  const gen = ++talkGen;
  // talking over tellr stops it, including audio still loading, so "stop" never gets talked over
  interruptSpeech();
  // holding the key means they're already talking, so always listen. the welcome (where you
  // are, then a question) is for the shortcut or button, which start a conversation instead.
  if ((session.off || !session.oriented) && holdMode !== "hold") {
    void welcome();
    return;
  }
  if (session.off) {
    setSession({ off: false });
    void sendOffscreen({ type: "offscreen-tone", name: "on" }).catch(() => {});
  }
  talkHold = true;
  talkStartedAt = Date.now();
  clearProcessWatchdog();
  setSession({ voice: { status: "listening", transcript: "", level: 0 }, notice: null, busy: false });
  clearListenWatchdog();
  listenWatchdog = setTimeout(() => {
    if (talkGen === gen && session.voice.status === "listening") void enqueue(() => stopTalk());
  }, 20_000);
  try {
    await sendOffscreen({ type: "offscreen-start", gen, backendUrl: await getBackendUrl() });
  } catch (error) {
    if (talkGen !== gen) return;
    talkHold = false;
    clearListenWatchdog();
    await fail(error?.message || "Tellr's microphone didn't start.");
    return;
  }
  if (talkGen === gen && !talkHold) {
    try {
      await sendOffscreen({ type: "offscreen-stop", gen });
    } catch {
      // the hold already ended
    }
  }
}

async function stopTalk() {
  const gen = talkGen;
  talkHold = false;
  clearListenWatchdog();
  if (session.voice.status === "listening") {
    setSession({ voice: { status: "processing", transcript: session.voice.transcript } });
    armProcessWatchdog();
  }
  try {
    await sendOffscreen({ type: "offscreen-stop", gen });
  } catch (error) {
    if (talkGen === gen && session.voice.status === "processing" && !session.busy) {
      await fail(error?.message || "Tellr's microphone didn't start.");
    }
  }
}

async function onSttEvent(event, gen) {
  if (!event || (gen != null && gen !== talkGen)) return;
  // the mic closed (released, pressed again, or the 12s cap), so the next toggle press starts fresh
  if (["processing", "final", "empty", "error"].includes(event.type)) talkHold = false;
  if (event.type === "level") {
    if (talkHold && event.level > VOICE_LEVEL) lastVoiceAt = Date.now();
    const now = Date.now();
    if (!talkHold || now - lastLevelAt < 200) return;
    lastLevelAt = now;
    setSession({ voice: { status: "listening", transcript: session.voice.transcript, level: event.level } });
    return;
  }
  if (event.type === "partial") {
    if (talkHold && event.text !== session.voice.transcript) lastVoiceAt = Date.now();
    setSession({
      voice: { status: talkHold ? "listening" : "processing", transcript: event.text, level: session.voice.level || 0 },
    });
    if (!talkHold) armProcessWatchdog();
    return;
  }
  if (event.type === "processing") {
    setSession({ voice: { status: "processing", transcript: session.voice.transcript } });
    armProcessWatchdog();
    return;
  }
  if (event.type === "empty") {
    clearProcessWatchdog();
    await notHeard();
    return;
  }
  if (event.type === "error") {
    clearProcessWatchdog();
    await fail(event.message);
    return;
  }
  if (event.type === "final") {
    clearProcessWatchdog();
    setSession({ voice: { status: "processing", transcript: event.text } });
    await handleTranscript(event.text);
  }
}

async function handleTranscript(raw) {
  const text = raw.trim().slice(0, MAX_REQUIREMENTS);
  if (!text) {
    await notHeard();
    return;
  }
  // once they've talked to tellr, the shortcut doesn't need to welcome them again
  session = pushHistory({ ...session, oriented: true }, "user", text.slice(0, 1000));
  // pausing and turning off must work instantly, even mid-search, so they skip the page read
  const early = classifyIntent(text, session);
  if (early === "pause") {
    await runPause();
    return;
  }
  if (early === "close") {
    await runClose();
    return;
  }
  // sounds like stopping: silent right away, then "pause or close?"
  if (early === "leave") {
    await runLeaveAsk();
    return;
  }
  // "never mind": stop talking and drop any pending question, keep everything else
  if (early === "cancel") {
    await runCancel();
    return;
  }
  // "are you there?" mid-search must not cancel or restart the search
  if (early === "status") {
    await runStatus();
    return;
  }
  // runAction wakes tellr up, so remember whether "continue" means resume or more items
  const wasPaused = session.paused;
  await runAction(async () => {
    const page = await extractActivePage();
    session = forgetStaleGoal(session, page, text);
    // which item the shopper is on comes from the tab's address, so a page that is slow to read
    // never drops them back into the list
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const here = page?.url || tab?.url || "";
    // a cart or checkout page is never "the item": money questions there go to the checkout review
    const onCheckout = page?.place === "cart" || page?.place === "checkout";
    const onListing = page ? page.pageKind === "listing" && !onCheckout : isItemUrl(here);
    focusOn(onListing ? here : "");
    persist();
    // whether a single item's page is open decides where "how's the wear on it?" goes
    const intent = classifyIntent(text, { ...session, paused: wasPaused, onListing, onCheckout });
    setSession({ activity: ACTIVITY[intent.split(":")[0]] || "working on that" });
    // tellr's last question stays open only while the shopper answers it or checks on tellr;
    // anything else moves on, so a later sentence isn't taken as its answer
    if (!["refine", "requirements", "repeat", "help", "where", "recap", "status"].includes(intent)) session = { ...session, awaiting: null };
    // "clear all your saved items?" lasts one reply too
    if (!intent.startsWith("clear-saved")) session = { ...session, pendingClearSaved: false };
    // the save offer lasts one reply; anything else is handled as said, and the offer is dropped
    if (!intent.startsWith("save-offer")) session = { ...session, pendingSaveOffer: null };
    // "read more" only continues the description it follows
    if (!intent.startsWith("read-description")) session = { ...session, descriptionLeft: "" };
    // the "search for ones that do?" offer only lasts for the next reply
    if (!intent.startsWith("search-")) session = { ...session, pendingSearch: false };
    // any other answer to "are you done shopping?" means keep going
    session = { ...session, pendingLeave: false };
    // the listing's seller, popularity, returns... for the side panel
    if (page) session = { ...session, facts: page.facts ?? null };
    if (intent === "resume") await runResume();
    else if (intent === "leave-cancel") {
      await finishAnswer("Okay, I'll keep everything.", { hint: true });
    }
    else if (intent === "help") await runHelp();
    else if (intent === "remember-size") await runRememberSize(text);
    else if (intent === "what-size") {
      const known = Object.entries(profile.sizes).map(([kind, size]) => `${SIZE_KIND_NAME[kind] || kind} size ${size}`);
      await finishAnswer(known.length ? `I remember your ${known.join(", ")}. Say forget my size to clear them.` : "I don't have any of your sizes saved. Say something like: my shoe size is 8.");
    } else if (intent === "forget-size") {
      // "forget my shoe size" forgets that one; "forget my sizes" forgets them all
      const kind = sizeKindIn(text);
      profile = kind ? { sizes: Object.fromEntries(Object.entries(profile.sizes).filter(([k]) => k !== kind)) } : { sizes: {} };
      void chrome.storage.local.set({ profile }).catch(() => {});
      await finishAnswer(kind ? `Okay, I've forgotten your ${SIZE_KIND_NAME[kind]} size.` : "Okay, I've forgotten your sizes.");
    }
    else if (intent === "save") await runSave(text);
    else if (intent === "save-offer-yes" || intent === "save-offer-no") await answerSaveOffer(intent === "save-offer-yes");
    else if (intent === "clear-saved") {
      const count = session.shortlist?.length || 0;
      if (!count) await finishAnswer("Your list is already empty.");
      else {
        session = { ...session, pendingClearSaved: true };
        await finishAnswer(`Clear all ${count} saved item${count === 1 ? "" : "s"}? They'll be gone next time too. Say yes to clear, or no to keep them.`);
      }
    } else if (intent === "clear-saved-yes") {
      changeSaved([], { op: "clear" });
      await finishAnswer("Your list is cleared.");
    } else if (intent === "clear-saved-no") await finishAnswer("Okay, I kept your list.");
    else if (intent === "unsave") await runUnsave(text);
    else if (intent === "list-saved") await finishAnswer(shortlistSpeech(session.shortlist));
    else if (intent === "open-saved") await runOpenSaved(text);
    else if (intent === "compare-saved") await runCompareSaved();
    else if (intent === "panel") {
      const keys = await shortcutWords();
      await finishAnswer(`Press ${keys.panel} to open the side panel. Chrome only opens it from a key press or a click, not from speech.`);
    } else if (intent === "panel-close") await runClosePanel();
    else if (intent === "shortcuts") await finishAnswer(shortcutsSpeech(await shortcutWords()));
    else if (intent === "recap") await finishAnswer(recapSpeech(session.preferences, session.asked, describeRequirement, budgetText));
    else if (intent === "where") await finishAnswer(placeSpeech(page), { hint: true });
    else if (intent === "repeat") await runRepeat();
    else if (intent === "cancel-confirm") await runCancelConfirm();
    else if (intent === "reset") await runReset();
    else if (intent === "correction") await finishAnswer("Sorry about that. What should I change?");
    else if (intent === "find") await runFind(text, parseSiteSearch(text));
    else if (intent === "list") await runList(page);
    else if (intent === "more") await runMore();
    else if (intent === "buy") await runBuy();
    else if (intent === "item-requirement") await runItemRequirement(text);
    else if (intent === "read-title") {
      const fresh = await extractActivePage();
      await finishAnswer(fresh?.title ? `The listing's title is: ${fresh.title}.` : "I couldn't read this listing's title.");
    } else if (intent === "read-description" || intent === "read-description-more") {
      const first = intent === "read-description";
      const source = first ? (await extractActivePage())?.sellerDescription || "" : session.descriptionLeft;
      const { spoken, left } = descriptionPart(source, first);
      session = { ...session, descriptionLeft: left };
      await finishAnswer(spoken);
    } else if (intent === "item-total") {
      // read fresh: the money comes straight from the page, never from an older snapshot
      const fresh = await extractActivePage({ fresh: true });
      await finishAnswer(itemTotalSpeech(fresh?.itemPriceCents ?? 0, fresh?.checkoutHints?.shippingCents ?? null), { hint: true });
    }
    else if (intent === "search-confirm") await runSearchForFit();
    else if (intent === "search-cancel") {
      session = { ...session, pendingSearch: false };
      await finishAnswer("Okay, staying on this one. I've still saved what you want.", { hint: true });
    }
    else if (intent === "back") await runBackToList();
    else if (intent === "checkout-question") await finishAnswer(checkoutAnswer(text, session.checkout, session.review));
    else if (intent.startsWith("facts:")) {
      const topic = intent.slice(6);
      await finishAnswer(factsSpeech(page?.facts, topic === "all" ? null : topic, session.preferences, page?.checkoutHints));
    }
    else if (intent === "choose") await runChoose(text);
    else if (intent === "compare") await runCompare(focusedOr(parseCompareList(text), text));
    else if (intent === "open") await runOpen(parseItemNumber(text));
    else if (intent === "confirm") await runConfirm();
    else if (intent === "review") await runReview();
    else if (intent === "page") await runPageQuestion(text, page);
    // runRequirements adds this to the conversation so far, so earlier answers are never lost
    else if (intent === "refine") await runRequirements(text);
    else if (intent === "unclear") await finishAnswer(`I'm not sure what you meant. ${nextHint(session)} Or say help.`);
    else if (intent === "inspect") await (isInspectCommand(text) ? runInspect(page) : runExplain(text.slice(0, MAX_QUESTION)));
    else if (intent === "explain") await runExplain(text.slice(0, MAX_QUESTION));
    else await runRequirements(text);
  }, text);
}

// what tellr is doing, for "are you there?" and the "still working" nudge
const ACTIVITY = {
  find: "searching for that",
  refine: "updating the search",
  requirements: "working out what you're looking for",
  inspect: "looking closely at the photos, which takes up to a minute",
  compare: "comparing those items, which takes up to a minute",
  choose: "looking at the small photos to find that",
  explain: "working out an answer",
  review: "checking the checkout page",
  list: "reading the page",
  more: "reading the page",
  open: "opening that item",
};

// shared by voice, typing, and side panel buttons: busy state on, errors spoken, busy off
async function runAction(task, transcript = session.voice.transcript) {
  // a new request (typed or a button) talks over nothing: older speech stops first
  interruptSpeech();
  // talking to tellr, or pressing a button, ends a pause
  setSession({ busy: true, paused: false, off: false, notice: null, voice: { status: "processing", transcript }, lastAnswer: "" });
  // a long quiet stretch gets a spoken "still working", at most twice per request
  const startedAt = Date.now();
  let nudges = 0;
  const nudge = setInterval(() => {
    if (!session.busy || session.paused || session.off || session.voice.status === "speaking" || nudges >= 2) return;
    if (Date.now() - Math.max(lastHeardAt, startedAt) < 12_000) return;
    nudges += 1;
    lastHeardAt = Date.now();
    void speak(nudges === 1 ? `Still ${session.activity || "working on that"}.` : "Still going. Thanks for waiting.");
  }, 1000);
  try {
    await task();
  } catch (error) {
    await fail(error instanceof ApiError ? error.message : error.message || "Something went wrong.");
  } finally {
    clearInterval(nudge);
    setSession({ busy: false, activity: "", voice: { status: session.voice.status === "speaking" ? "speaking" : "idle", transcript: session.voice.transcript } });
  }
}

// toggle mode: one press starts listening, the next press (or the 12s cap) stops it
async function toggleTalk() {
  if (talkHold) {
    await stopTalk();
    return;
  }
  holdMode = "toggle";
  await startTalk();
}

function spokenKeys(label) {
  return String(label || "")
    .replace(/⌘/g, " Command ")
    .replace(/⌥/g, " Option ")
    .replace(/⇧/g, " Shift ")
    .replace(/⌃/g, " Control ")
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function shortcutWords() {
  const settings = await getSettings();
  const mac = /Mac/i.test(navigator.userAgent);
  const commands = await chrome.commands.getAll().catch(() => []);
  // read from chrome, so a shortcut the shopper changed is the one tellr says
  const key = (name, fallback) => {
    const shortcut = commands.find((c) => c.name === name)?.shortcut;
    return shortcut ? spokenKeys(shortcut) : fallback;
  };
  return {
    hold: spokenKeys(formatHoldKey(settings.holdKey, mac)),
    toggle: key("toggle-listening", "the Start listening button in the side panel"),
    panel: key("open-tellr", "the Tellr button in the toolbar"),
    stop: key("stop-speaking", "the Stop speaking button"),
    close: key("close-tellr", "the close key"),
  };
}

async function runHelp() {
  await finishAnswer(helpSpeech(session, await shortcutWords()));
}

async function runRepeat() {
  const last = session.lastSpoken;
  if (!last) {
    await finishAnswer(`I haven't said anything yet. ${nextHint(session)}`);
    return;
  }
  setSession({ lastAnswer: last });
  await speak(last);
}

async function runCancelConfirm() {
  session = { ...session, pendingConfirm: null };
  await finishAnswer("Okay, I won't confirm. Nothing was ordered.", { hint: true });
}

function toResults(products) {
  return products
    .filter((item) => Number.isInteger(item.priceCents) && item.priceCents > 0 && /^https?:\/\//i.test(item.url || ""))
    .slice(0, 30)
    .map((item) => ({
      title: String(item.title).slice(0, 120),
      priceCents: item.priceCents,
      url: item.url,
      // kept so "the one with the red bow" or "the less worn ones" can be worked out
      imageUrl: /^https?:\/\//i.test(item.imageUrl || "") ? item.imageUrl : "",
      condition: String(item.condition || "").slice(0, 80),
    }));
}

// "find black jackets under $100 on ebay": save the requirements from the same sentence, then
// search that site using the shopper's own words and read back what's there
async function runFind(text, found) {
  let questions = [];
  const conversation = conversationWith(text);
  try {
    const data = await parseRequirements(await getBackendUrl(), conversation.text);
    session = {
      ...session,
      preferences: data.preferences,
      clarificationQuestions: data.clarificationQuestions ?? [],
      requirementsTurns: conversation.turns,
      requirementsText: conversation.text,
      demoOrderId: null,
    };
    questions = data.clarificationQuestions ?? [];
  } catch {
    // still search; the budget just won't be screened
  }
  const bounds = priceBounds(conversation.text, session.preferences?.maxTotalCents ?? null);
  await runSearch({ query: found.query, ...bounds }, { site: found.site, questions });
}

const TOP_PICKS = 3;
const EVALUATE_COUNT = 8;
const VERDICT_RANK = { great_pick: 0, good_pick: 1, okay_pick: 2, risky: 3, not_a_match: 4 };
const VERDICT_WORDS = {
  great_pick: "a great pick",
  good_pick: "a good pick",
  okay_pick: "an okay pick",
  risky: "risky",
  not_a_match: "not a match",
};

// looks at the photos of results from..from+count: a plain description (look and likely feel)
// plus a fair verdict for the price, using the shopper's own words. failures keep the titles.
async function evaluateResults(from, count) {
  const todo = session.results
    .slice(from, from + count)
    .map((item, i) => ({ item, number: from + i + 1 }))
    .filter(({ item }) => !item.verdict);
  if (!todo.length) return false;
  try {
    const thumbs = await Promise.all(todo.map(({ item }) => thumbnailFor(item.imageUrl)));
    const evaluated = await describeItems(await getBackendUrl(), {
      items: todo.map(({ item, number }, i) => ({
        number,
        title: item.title,
        priceCents: item.priceCents,
        ...(item.condition ? { condition: item.condition } : {}),
        ...(thumbs[i] ? { thumbnail: thumbs[i] } : {}),
      })),
      preferences: session.preferences ?? undefined,
      notes: session.requirementsText || undefined,
    });
    const byNumber = new Map(evaluated.items.map((entry) => [entry.number, entry]));
    session = {
      ...session,
      followUp: evaluated.followUp || "",
      results: session.results.map((item, i) => {
        const entry = byNumber.get(i + 1);
        return entry ? { ...item, description: entry.description, verdict: entry.verdict, reason: entry.reason } : item;
      }),
    };
    return true;
  } catch {
    return false;
  }
}

// one item, the way it's read aloud: price, verdict, what it's like, and why
// the full description is read once per item; after that, a few words remind which one it is
function wasHeard(url) {
  return Boolean(url) && (session.heard || []).includes(itemKey(url));
}

function markHeard(urls) {
  const keys = urls.filter(Boolean).map(itemKey);
  session = { ...session, heard: [...new Set([...(session.heard || []), ...keys])].slice(-100) };
}

// the item the shopper is on. a different item starts its own conversation; "" means the list
function focusOn(url) {
  const key = url ? itemKey(url) : "";
  if (key === session.focusKey) return;
  session = { ...session, focusKey: key, itemTalk: [] };
}

// "go back": back to the results, and the top picks again in a few words each
async function runBackToList() {
  if (await offerSaveBeforeLeaving({ intent: "back", text: "go back" })) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const site = siteOf(tab?.url) || "ebay";
  if (tab?.id != null && session.lastSearch) {
    const loaded = waitForTabLoad(tab.id, { navigating: true });
    await chrome.tabs.update(tab.id, { url: searchUrl(site, session.lastSearch) });
    await loaded;
  }
  focusOn("");
  session = { ...session, listing: null, report: null, checkout: null, review: null, pendingConfirm: null };
  await readResults("Back to the list.", "", "");
}

// in a comparison: a reminder for items already described, the full description the first time
function compareName(entry) {
  const item = session.results.find((result) => itemKey(result.url) === itemKey(entry.url)) || { title: entry.title, description: entry.description };
  return wasHeard(entry.url) || !item.description ? reminderName(item) : item.description.replace(/[.!?\s]+$/, "");
}

// of: how many there are, so "number 2 of 3" says where the shopper is and how many are left
function itemLine(item, number, of = 0) {
  const verdict = VERDICT_WORDS[item.verdict];
  const what = wasHeard(item.url)
    ? `${reminderName(item).replace(/^./, (c) => c.toUpperCase())}.`
    : (item.description || item.title).replace(/\s*$/, "").replace(/([^.!?])$/, "$1.");
  return `Number ${number}${of > 1 ? ` of ${of}` : ""}, ${formatUsd(item.priceCents)}${verdict ? `, ${verdict}` : ""}: ${what}${item.reason ? ` ${item.reason}` : ""}`;
}

// reads items one at a time, boxing each on the page as it's spoken, then the closing line.
// talking or "stop speaking" ends the reading instead of carrying on afterwards.
let readingGen = 0;
async function announce(lines, numbers, closing) {
  const full = [...lines, closing].filter(Boolean).join(" ");
  session = pushHistory({ ...session, lastAnswer: full, lastSpoken: full, notice: null }, "assistant", full);
  persist();
  broadcast({ type: "session", session });
  const run = ++readingGen;
  for (let i = 0; i < lines.length; i++) {
    if (run !== readingGen) return;
    glowResults([numbers[i]]);
    if (!(await speakAndWait(lines[i]))) break;
  }
  if (run !== readingGen) return;
  await speak(closing);
}

// says the budget summary while the photos are checked, then the best few, best first
function questionTail(questions) {
  const question = nextQuestion(questions);
  return question ? ` One question: ${question}` : "";
}

async function readResults(intro, tail = "", opener = "Let me look at the photos and pick the best few.") {
  await speak([intro, opener].filter(Boolean).join(" "));
  let checked = EVALUATE_COUNT;
  const evaluated = await evaluateResults(0, EVALUATE_COUNT);
  // fewer than 2 good picks in the first 8: look at the next 8 before choosing
  const goodCount = () => session.results.slice(0, checked).filter((item) => VERDICT_RANK[item.verdict] <= 1).length;
  if (evaluated && goodCount() < 2 && session.results.length > EVALUATE_COUNT && !session.off) {
    if (await evaluateResults(EVALUATE_COUNT, EVALUATE_COUNT)) checked = EVALUATE_COUNT * 2;
  }
  if (evaluated) {
    // best first; the numbers and page badges follow this order
    const head = session.results.slice(0, checked).map((item, index) => ({ item, index }));
    head.sort((a, b) => (VERDICT_RANK[a.item.verdict] ?? 9) - (VERDICT_RANK[b.item.verdict] ?? 9) || a.index - b.index);
    session = { ...session, results: [...head.map((h) => h.item), ...session.results.slice(checked)] };
  }
  labelResultsOnPage();
  const picks = session.results.slice(0, TOP_PICKS).filter((item) => item.verdict !== "not_a_match");
  session = { ...session, resultsOffset: TOP_PICKS, focusNumbers: picks.map((_, i) => i + 1) };
  if (!picks.length) {
    await finishAnswer(
      `None of the top results really match what you asked for. Say more to hear them anyway, or tell me what to change.${tail}`,
    );
    return;
  }
  // tellr's own requirement question (like the size) wins over the comparison question
  const followUp = tail.includes("One question:") ? "" : nextQuestion([session.followUp]);
  const question = followUp ? ` ${followUp}` : "";
  const closing = `Say open and a number, or compare them.${question}${tail.replace(" You can also say compare the top 3.", "")}`;
  // the top picks: "number 1 of 3"
  const lines = picks.map((item, i) => itemLine(item, i + 1, picks.length));
  markHeard(picks.filter((item) => item.description).map((item) => item.url));
  await announce(lines, picks.map((_, i) => i + 1), closing);
}

// show on the page what tellr is talking about: number badges on listed items, and a glow
// (scrolled into view) on the item or items being discussed. visual only; never required.
async function showOnPage(message) {
  // off means off: work still finishing must not draw on the page
  if (session.off) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

function labelResultsOnPage() {
  void showOnPage({ type: "label-results", items: session.results.map((item, i) => ({ number: i + 1, url: item.url })) });
}

function glowResults(numbers) {
  const urls = numbers.map((n) => session.results[n - 1]?.url).filter(Boolean);
  if (urls.length) void showOnPage({ type: "highlight", urls });
}

async function runList(knownPage) {
  const page = knownPage || (await extractActivePage());
  if (!page) {
    await finishAnswer("I need a shopping page in front. Open a search results page, then say list them.");
    return;
  }
  const results = toResults(namedProducts(page.products || [], page.title));
  if (!results.length) {
    await finishAnswer(
      page.pageKind === "listing" && page.itemPriceCents > 0
        ? `This looks like one listing: ${page.title}, ${formatUsd(page.itemPriceCents)}. Say check this item.`
        : "I couldn't find a list of items with prices here. Try scrolling, or open a search results page.",
    );
    return;
  }
  const { shown, intro } = screenForShopper(results);
  session = { ...session, pageUrl: page.url, results: shown, resultsOffset: 0 };
  await readResults(intro);
}

// screens a results list against the current budget and the shopper's own words
function screenForShopper(results) {
  const said = session.requirementsText || "";
  const bounds = priceBounds(said, session.preferences?.maxTotalCents ?? null);
  const keywords = keywordsFrom(said, session.preferences);
  const screened = screenResults(results, bounds, keywords);
  if (screened.fit.length) {
    return { shown: screened.fit, fitCount: screened.fit.length, intro: screeningSummary(results.length, screened, bounds, keywords) };
  }
  const cheapest = [...results].sort((a, b) => a.priceCents - b.priceCents);
  const intro =
    bounds.maxCents === null && bounds.minCents === null
      ? null
      : `None of the ${results.length} items fit your budget. Here are the lowest prices instead.`;
  return { shown: cheapest, fitCount: 0, intro };
}

async function runMore() {
  const offset = session.resultsOffset || 0;
  if (offset >= session.results.length) {
    await finishAnswer("That's all the items I can read on this page. Say open and a number to pick one.");
    return;
  }
  await evaluateResults(offset, TOP_PICKS);
  const next = session.results.slice(offset, offset + TOP_PICKS);
  const numbers = next.map((_, i) => offset + i + 1);
  session = { ...session, resultsOffset: offset + TOP_PICKS };
  const left = session.results.length - (offset + next.length);
  // further results: their place among everything found, "number 4 of 8"
  const lines = next.map((item, i) => itemLine(item, numbers[i], session.results.length));
  markHeard(next.filter((item) => item.description).map((item) => item.url));
  await announce(
    lines,
    numbers,
    left > 0 ? "Say more for others, or open a number." : "That's all I can read here. Say open and a number to pick one.",
  );
}

async function runOpen(number) {
  if (await offerSaveBeforeLeaving({ intent: "open", text: `open number ${number}` })) return;
  if (!session.results?.length) {
    const page = await extractActivePage();
    session = { ...session, results: toResults(namedProducts(page?.products || [], page?.title)), resultsOffset: 0 };
  }
  const item = Number.isInteger(number) && number > 0 ? session.results[number - 1] : null;
  if (!item) {
    await finishAnswer(
      session.results.length
        ? `I only have ${session.results.length} items. Say list them to hear the numbers.`
        : "I don't see a list of items here. Open a search results page, then say list them.",
    );
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || tab.url === item.url) {
    await finishAnswer(`${item.title} is already open. Say check this item.`);
    return;
  }
  await chrome.tabs.update(tab.id, { url: item.url });
  focusOn(item.url);
  // already inspected during a comparison: reuse it so the shopper can ask questions right away
  const checked = (session.comparisons || []).find((entry) => entry.url === item.url);
  session = {
    ...session,
    pageUrl: item.url,
    listing: checked?.listing ?? null,
    report: checked?.report ?? null,
    checkout: null,
    review: null,
    pendingConfirm: null,
  };
  await finishAnswer(
    checked
      ? `Opening number ${number}, ${reminderName(item)}, ${formatUsd(item.priceCents)}. I already checked its photos. Ask me anything about it, like how worn it is, or go to checkout and say review checkout.`
      : `Opening number ${number}, ${reminderName(item)}, ${formatUsd(item.priceCents)}. When it loads, ask me how it looks or how worn it is, or say check this item.`,
  );
}

const TAB_LOAD_MS = 15_000;

// navigating: set up before telling an existing tab to go somewhere new. right after that
// call the tab can still report the old page as "complete", so only a fresh load event counts.
function waitForTabLoad(tabId, { navigating = false } = {}) {
  return new Promise((resolve) => {
    let timer = null;
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    function done() {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    }
    timer = setTimeout(done, TAB_LOAD_MS);
    chrome.tabs.onUpdated.addListener(listener);
    if (!navigating) chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done(), done);
  });
}

// types the shopper's requirements into the site's search, waits for the results, and reads
// back what fits. stays in the tab when it's already a marketplace or a blank tab.
async function runSearch(search, { site: wanted = null, questions = [] } = {}) {
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const site = wanted || siteOf(current?.url) || "ebay";
  const url = searchUrl(site, search);
  if (session.off) return;
  await speak(`Got it. Searching ${SITE_NAME[site]} for ${describeSearch(search)}.`);
  let tabId;
  const reuse = current?.id != null && (siteOf(current.url) === site || !/^https?:/i.test(current.url || ""));
  if (reuse) {
    tabId = current.id;
    if (current.url !== url) {
      const loaded = waitForTabLoad(tabId, { navigating: true });
      await chrome.tabs.update(tabId, { url });
      await loaded;
    }
  } else {
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await waitForTabLoad(tabId);
  }
  holdTabId = tabId;
  if (session.off) return;
  const page = await extractTab(tabId, 8000);
  session = {
    ...session,
    pageUrl: url,
    lastSearch: search,
    listing: null,
    report: null,
    checkout: null,
    review: null,
    pendingConfirm: null,
    comparisons: [],
    focusNumbers: [],
  };
  // a question tellr still has (like the size) comes after the results
  const ask = questionTail(questions);
  const results = toResults(namedProducts(page?.products || [], page?.title));
  if (!results.length) {
    session = { ...session, results: [], resultsOffset: 0 };
    await finishAnswer(
      `I searched ${SITE_NAME[site]} for ${describeSearch(search)}, but I couldn't read any results yet. Say list them in a moment, or tell me different words.${ask}`,
    );
    return;
  }
  const { shown, intro } = screenForShopper(results);
  session = { ...session, results: shown, resultsOffset: 0 };
  await readResults(intro, ask);
}

// opens one result in a background tab, reads its own gallery, and runs the full inspection
async function inspectResult(item, backendUrl) {
  const tab = await chrome.tabs.create({ url: item.url, active: false });
  try {
    await waitForTabLoad(tab.id);
    const page = await extractTab(tab.id, 8000);
    if (!page) throw new Error("its page didn't load");
    const images = await listingImagesFromUrls(page.imageUrls || []);
    if (!images.length) throw new Error("I couldn't read its photos");
    const listing = buildListing({ ...page, pageKind: "listing" }, images);
    const report = await inspectListing(backendUrl, listing, session.preferences);
    return { listing, report };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// moves to the real buy / cart / checkout button and focuses it so the shopper presses it.
// tellr never clicks it and never enters payment details.
async function runBuy() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let label = null;
  if (tab?.id != null && /^https?:/i.test(tab.url || "")) {
    const found = await chrome.tabs.sendMessage(tab.id, { type: "find-action" }).catch(() => null);
    label = found?.label ?? null;
  }
  const after = "When you're on the checkout page, say review checkout, and I'll check the total, fees, and add-ons before you pay. I never buy anything or enter payment details for you.";
  if (!label) {
    await finishAnswer(
      `I couldn't find a buy or cart button on this page. With VoiceOver, press Control Option U to list the buttons, or with Voice Control, say click add to cart. ${after}`,
    );
    return;
  }
  await finishAnswer(
    `I've moved to the ${label} button. Press it yourself: Control Option Space with VoiceOver, or Enter. ${after}`,
  );
}

// marks tellr drew on pages (boxes, numbers) come off when the shopper is done
async function clearPageMarks() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) {
    if (tab.id != null && /^https?:/i.test(tab.url || "")) chrome.tabs.sendMessage(tab.id, { type: "clear-marks" }).catch(() => {});
  }
}

// "compare them" right after "which ones are leather?" means those items, not the top of the list
function focusedOr(numbers, said) {
  const pointsBack = /\b(them|those|these)\b/i.test(said) && !/\d|\b(two|three)\b/i.test(said);
  return pointsBack && session.focusNumbers?.length > 1 ? session.focusNumbers.slice(0, MAX_COMPARE) : numbers;
}

const CHOOSE_ITEMS = 10;

// "the one with the red bow", "the less worn ones", "the boots": work out which listed items
// are meant, then do what was asked: open the best match, compare the matches, or say which
async function runChoose(said) {
  const action = /\b(compare|check|inspect|look closer)\b/i.test(said)
    ? "compare"
    : /\b(open|select|pick|choose|go with|take|show me|i like)\b/i.test(said)
      ? "open"
      : "tell";
  const items = session.results.slice(0, CHOOSE_ITEMS);
  // short "open that one" / "compare those" right after tellr named matches: use those
  const backRef = /\b(that one|this one|it|them|those|these)\b/i.test(said) && said.trim().split(/\s+/).length <= 4;
  if (backRef && session.focusNumbers?.length) {
    if (action === "compare" && session.focusNumbers.length > 1) await runCompare(session.focusNumbers.slice(0, MAX_COMPARE));
    else await runOpen(session.focusNumbers[0]);
    return;
  }
  let numbers;
  let answer;
  const cheap = /\b(cheapest|least expensive|lowest price|cheaper)\b/i.test(said);
  const pricey = /\b(most expensive|priciest|pricier|highest price)\b/i.test(said);
  if ((cheap || pricey) && !/\b(with|has|that|which|and)\b/i.test(said)) {
    // price is exact in code, no need to ask claude
    const order = items
      .map((item, i) => ({ number: i + 1, item }))
      .sort((a, b) => (cheap ? a.item.priceCents - b.item.priceCents : b.item.priceCents - a.item.priceCents));
    numbers = order.slice(0, /\bones\b/i.test(said) ? MAX_COMPARE : 1).map((o) => o.number);
    answer = `${cheap ? "Lowest" : "Highest"} price: ${numbers
      .map((n) => `number ${n}, ${items[n - 1].title}, ${formatUsd(items[n - 1].priceCents)}`)
      .join("; ")}.`;
  } else {
    const thumbs = await Promise.all(items.map((item) => thumbnailFor(item.imageUrl)));
    const result = await chooseItems(await getBackendUrl(), {
      question: said.slice(0, 500),
      items: items.map((item, i) => ({
        number: i + 1,
        title: item.title,
        priceCents: item.priceCents,
        ...(item.condition ? { condition: item.condition } : {}),
        ...(thumbs[i] ? { thumbnail: thumbs[i] } : {}),
      })),
      preferences: session.preferences ?? undefined,
    });
    numbers = result.numbers;
    answer = result.answer;
  }
  if (!numbers.length) {
    await finishAnswer(`${answer} You can also say a number.`);
    return;
  }
  session = { ...session, focusNumbers: numbers };
  glowResults(numbers);
  if (action === "open" || (action === "compare" && numbers.length === 1)) {
    await runOpen(numbers[0]);
    return;
  }
  if (action === "compare") {
    await runCompare(numbers.slice(0, MAX_COMPARE));
    return;
  }
  const next = numbers.length > 1 ? `Say open number ${numbers[0]}, or compare them.` : `Say open number ${numbers[0]} to go to it.`;
  await finishAnswer(`${answer} ${next}`);
}

// "compare the top 3": inspect several results side by side and rank them by fit
async function runCompare(numbers) {
  if (!session.preferences) {
    await finishAnswer("Tell me what you want first, so I know what to check them against.");
    return;
  }
  if (!session.results?.length) {
    const page = await extractActivePage();
    const results = toResults(namedProducts(page?.products || [], page?.title));
    session = { ...session, results: results.length ? screenForShopper(results).shown : [], resultsOffset: 0 };
  }
  const picks = (numbers || []).map((n) => ({ number: n, item: session.results[n - 1] })).filter((p) => p.item);
  if (picks.length < 2) {
    await finishAnswer(
      session.results.length
        ? `I have ${session.results.length} items. Say list them to hear the numbers, then compare two or three.`
        : "I don't see a list of items here. Open a search results page, then say list them.",
    );
    return;
  }
  await compareItems(picks);
}

// --- the shortlist: items saved to come back to, across searches ---

// what's known about an item, for its line on the list: the photo check's flaw and unknown when
// it was checked, else the quick judgement from the results
function savedEntry(item, report) {
  const assessments = report?.assessments || [];
  const flaw = assessments.find((a) => a.status === "contradicted");
  const unknown = assessments.find((a) => a.status === "unknown");
  return {
    key: itemKey(item.url),
    url: item.url,
    title: item.title || "Untitled item",
    description: item.description || "",
    priceCents: item.priceCents || 0,
    fit: item.verdict || "",
    flaw: flaw ? firstSentence(flaw.explanation) : ["risky", "not_a_match"].includes(item.verdict) && item.reason ? item.reason : "",
    unknown: unknown ? firstSentence(unknown.explanation) : "",
    kind: topicFromText(`${item.title || ""} ${session.preferences?.category || ""}`) || "",
    savedAt: Date.now(),
  };
}

// a closer look at a saved item updates its line
function refreshSaved(url, report) {
  const key = itemKey(url);
  if (!report || !(session.shortlist || []).some((entry) => entry.key === key)) return;
  let updated = null;
  const list = session.shortlist.map((entry) => {
    if (entry.key !== key) return entry;
    const fresh = savedEntry({ ...entry, verdict: entry.fit }, report);
    updated = { ...entry, flaw: fresh.flaw || entry.flaw, unknown: fresh.unknown };
    return updated;
  });
  if (updated) changeSaved(list, { op: "save", item: updated });
}

// leaving an item ("go back", "open number 3"): offer once to save it first. returns true when
// it asked, so the leaving waits for the yes or no. not offered for items already saved, or
// twice for the same item.
async function offerSaveBeforeLeaving(then) {
  const key = session.focusKey;
  if (!key || session.pendingSaveOffer) return false;
  if ((session.shortlist || []).some((entry) => entry.key === key) || (session.saveOffered || []).includes(key)) return false;
  let item = session.results.find((result) => itemKey(result.url) === key) || null;
  if (!item) {
    const page = await extractActivePage();
    if (page?.url && itemKey(page.url) === key) item = { url: page.url, title: page.title, priceCents: page.itemPriceCents };
  }
  if (!item?.url) return false;
  const checked = session.report || (session.comparisons || []).find((entry) => itemKey(entry.url) === key)?.report || null;
  session = {
    ...session,
    saveOffered: [...(session.saveOffered || []), key].slice(-50),
    pendingSaveOffer: { entry: savedEntry(item, checked), then },
  };
  await finishAnswer("Before you go, want me to save this one to your list?");
  return true;
}

// the answer to the save offer, then what the shopper was doing
async function answerSaveOffer(yes) {
  const offer = session.pendingSaveOffer;
  session = { ...session, pendingSaveOffer: null };
  if (!offer) return;
  if (yes) {
    changeSaved([...(session.shortlist || []), offer.entry], { op: "save", item: offer.entry });
    await speak(`Saved ${reminderName(offer.entry)}.`);
  }
  const { intent, text } = offer.then;
  if (intent === "back") await runBackToList();
  else if (intent === "open") await runOpen(parseItemNumber(text));
  else if (intent === "open-saved") await runOpenSaved(text);
}

// "save this one" on an item, "save number 2" while hearing results
async function runSave(said) {
  const number = parseItemNumber(said);
  let item = null;
  let report = null;
  if (number != null) {
    item = session.results?.[number - 1] || null;
  } else if (session.focusKey) {
    item = session.results.find((result) => itemKey(result.url) === session.focusKey) || null;
    if (!item) {
      const page = await extractActivePage();
      if (page) item = { url: page.url, title: page.title, priceCents: page.itemPriceCents };
    }
    report = session.report;
  } else if (session.focusNumbers?.length === 1) {
    item = session.results[session.focusNumbers[0] - 1] || null;
  }
  if (!item?.url) {
    await finishAnswer("Which one? Say save number 2 while I'm reading results, or open an item and say save this one.");
    return;
  }
  const checked = report || (session.comparisons || []).find((entry) => itemKey(entry.url) === itemKey(item.url))?.report || null;
  const entry = savedEntry(item, checked);
  const list = session.shortlist || [];
  const at = list.findIndex((saved) => saved.key === entry.key);
  if (at >= 0) {
    const updated = { ...list[at], ...entry, savedAt: list[at].savedAt };
    changeSaved(list.map((saved, i) => (i === at ? updated : saved)), { op: "save", item: updated });
    await finishAnswer(`That one's already saved, as saved ${at + 1}.`, { hint: true });
    return;
  }
  changeSaved([...list, entry], { op: "save", item: entry });
  await finishAnswer(`Saved ${reminderName(entry)}. You have ${session.shortlist.length} saved. Say what's on my list to hear them.`);
}

// "remove saved 2", "take this one off my list"
async function runUnsave(said) {
  const list = session.shortlist || [];
  const number = parseSavedNumber(said) ?? parseItemNumber(said);
  let at = number != null ? number - 1 : -1;
  if (number == null && session.focusKey) at = list.findIndex((entry) => entry.key === session.focusKey);
  if (at < 0 || !list[at]) {
    await finishAnswer(list.length ? `Which one? Say remove saved 1, up to saved ${list.length}.` : "Your list is empty.");
    return;
  }
  const removed = list[at];
  changeSaved(list.filter((_, i) => i !== at), { op: "remove", key: removed.key });
  await finishAnswer(`Removed ${reminderName(removed)}. You have ${session.shortlist.length} saved.`);
}

// "open saved 2": its page, wherever it came from
async function runOpenSaved(said) {
  if (await offerSaveBeforeLeaving({ intent: "open-saved", text: said })) return;
  const list = session.shortlist || [];
  const number = parseSavedNumber(said) ?? parseItemNumber(said);
  const entry = number != null ? list[number - 1] : null;
  if (!entry) {
    await finishAnswer(list.length ? `Which one? Say open saved 1, up to saved ${list.length}.` : "Your list is empty.");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null && tab.url !== entry.url) await chrome.tabs.update(tab.id, { url: entry.url });
  focusOn(entry.url);
  const checked = (session.comparisons || []).find((c) => itemKey(c.url) === entry.key);
  session = { ...session, pageUrl: entry.url, listing: checked?.listing ?? null, report: checked?.report ?? null, checkout: null, review: null, pendingConfirm: null };
  await finishAnswer(`Opening ${savedLine(entry, number).replace(/^Saved/, "saved")}`, { hint: true });
}

// "compare my saved ones": the first three on the list, side by side
async function runCompareSaved() {
  const list = session.shortlist || [];
  if (list.length < 2) {
    await finishAnswer(list.length ? "You have one saved. Save another to compare them." : "Your list is empty. Save a few first, then compare them.");
    return;
  }
  if (!session.preferences) {
    await finishAnswer("Tell me what you want first, so I know what to check them against.");
    return;
  }
  const picks = list.slice(0, MAX_COMPARE).map((entry, i) => ({ number: i + 1, item: entry }));
  if (list.length > MAX_COMPARE) await speak(`You have ${list.length} saved. I'll compare the first ${MAX_COMPARE}.`);
  await compareItems(picks, { saved: true });
}

// "close the panel": chrome 141+ allows closing without a key press
async function runClosePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (chrome.sidePanel.close && tab?.windowId != null) {
      await chrome.sidePanel.close({ windowId: tab.windowId });
      await finishAnswer("Closed the side panel.");
      return;
    }
  } catch {
    // not open, or not supported
  }
  await finishAnswer("I can't close it from here in this version of Chrome. Use the close button at the top of the panel.");
}

// checks the picked items side by side and ranks them. saved: they come from the shortlist, so
// they're named "saved 2" and nothing is boxed on the page (they may be from another search)
async function compareItems(picks, { saved = false } = {}) {
  const label = (n) => (saved ? `saved ${n}` : `number ${n}`);
  // the shopper hears something while the photos are checked
  await speak(`Checking ${picks.length} items side by side. This takes up to a minute.`);
  const backendUrl = await getBackendUrl();
  const outcomes = await Promise.allSettled(picks.map((p) => inspectResult(p.item, backendUrl)));
  const checked = [];
  const failed = [];
  outcomes.forEach((outcome, i) => {
    const { number, item } = picks[i];
    if (outcome.status === "fulfilled") {
      checked.push({ number, title: item.title, description: item.description, priceCents: item.priceCents, url: item.url, ...outcome.value });
    } else {
      failed.push({ number, reason: outcome.reason?.message || "something went wrong" });
    }
  });
  session = { ...session, comparisons: checked.map(({ number, url, listing, report }) => ({ number, url, listing, report })) };
  for (const entry of checked) refreshSaved(entry.url, entry.report);
  if (!checked.length) {
    await finishAnswer(`I couldn't check those items. ${failed.map((f) => `${label(f.number)}: ${f.reason}.`).join(" ")}`);
    return;
  }
  const missed = failed.map((f) => `I couldn't check ${label(f.number)}: ${f.reason}.`).join(" ");
  // a fair, human ranking for the price; the mechanical summary is only a fallback
  try {
    const judged = await judgeItems(backendUrl, {
      items: checked.map(({ number, title, priceCents, report }) => ({ number, title, priceCents, report })),
      preferences: session.preferences,
      notes: session.requirementsText || undefined,
    });
    const byNumber = new Map(checked.map((entry) => [entry.number, entry]));
    const order = judged.ranking.map((r) => r.number);
    if (!saved) session = { ...session, focusNumbers: order };
    const lines = judged.ranking.map(
      (r, i) =>
        `${i === 0 ? "Best" : "Next"}: ${label(r.number)}, ${compareName(byNumber.get(r.number))}, ${formatUsd(byNumber.get(r.number).priceCents)}, ${VERDICT_WORDS[r.verdict]}. ${r.summary}`,
    );
    markHeard(checked.map((entry) => entry.url));
    const closing = [missed, `Say open ${label(order[0])} to go to it.`, nextQuestion([judged.followUp])].filter(Boolean).join(" ");
    // saved items may not be on this page, so there's nothing to box while reading them
    await announce(lines, saved ? order.map(() => null) : order, closing);
  } catch {
    const best = [...checked].sort((a, b) => fitScore(b.report) - fitScore(a.report) || a.priceCents - b.priceCents)[0];
    if (best && !saved) glowResults([best.number]);
    await finishAnswer(compareSpeech(checked, failed, session.preferences.requirements));
  }
}

// the requirements route rejects more than 2000 characters
const MAX_CONVERSATION_CHARS = 1900;

// everything the shopper has said about the current goal, so claude never forgets an earlier
// answer (budget, size) when asking its next question. a new goal ("start over", or a different
// kind of item, which clears the preferences) starts a fresh conversation.
// the shopper's usual size for this kind of item, when nothing in the conversation says a size
function usualSizeLine(conversation, next = "") {
  const kind = goalKind(next);
  const size = kind ? profile.sizes[kind] : "";
  // only when the conversation itself doesn't already give a size
  if (!size || keywordsFrom(conversation, null).some((word) => /^size /.test(word.label))) return "";
  return profileLine(kind, size);
}

// what the shopper said, with tellr's question in front of an answer ("Tellr asked: what size?
// The shopper answered: size 8") so short answers keep their meaning, and every answer so far
// on top, so trimming an old turn never loses one
function conversationWith(next, answered = null) {
  const turn = answered ? `Tellr asked: ${answered.question} The shopper answered: ${answered.answer}` : next;
  const turns = session.preferences ? [...(session.requirementsTurns || []), turn] : [turn];
  const summary = [answersSoFar(session.asked), usualSizeLine([...turns].join(" "), next)].filter(Boolean).join("\n");
  const render = (list) =>
    [summary, ...list.map((t, i) => (i === 0 || t.startsWith("Tellr asked:") ? t : `Then the shopper said: ${t}`))].filter(Boolean).join("\n");
  // keep the first request and as many of the latest answers as fit
  let kept = turns;
  while (kept.length > 2 && render(kept).length > MAX_CONVERSATION_CHARS) kept = [kept[0], ...kept.slice(2)];
  const text = render(kept);
  return { turns: kept, text: text.length > MAX_CONVERSATION_CHARS ? text.slice(-MAX_CONVERSATION_CHARS) : text };
}

// the question tellr is about to ask: kept, so its answer is understood and it's never repeated
function noteQuestion(question) {
  if (!question) return;
  const entry = { topic: topicOf(question), question, answer: null };
  session = { ...session, asked: [...(session.asked || []), entry].slice(-20), awaiting: { topic: entry.topic, question } };
}

// the first follow-up worth asking from a list, skipping any topic already asked; noted as asked
function nextQuestion(questions) {
  const [question] = askable(session.asked, questions);
  noteQuestion(question);
  return question || "";
}

// what the shopper just said, kept as the answer to tellr's last question
function recordAnswer(said) {
  const waiting = session.awaiting;
  if (!waiting) return null;
  // not an answer to that question: a new statement. the question stays open so it can be
  // repeated once ("and what's the most you'd like to spend?"); after that it's dropped
  if (!answerFits(waiting.topic, said)) {
    session = { ...session, awaiting: waiting.repeated ? null : { ...waiting, unanswered: true } };
    return null;
  }
  // without the transcript's own full stop, so it reads "Got it: forty dollars."
  let answer = said.trim().slice(0, 200).replace(/[.!?]+$/, "");
  if (NO_PREFERENCE.test(answer)) answer = "no preference";
  // "8" to "what size?" is a size, so the search and the screening read it as one
  else if (waiting.topic === "size" && sizeAnswer(answer)) answer = `size ${sizeAnswer(answer)}`;
  const asked = [...(session.asked || [])];
  for (let i = asked.length - 1; i >= 0; i -= 1) {
    if (asked[i].question === waiting.question && !asked[i].answer) {
      asked[i] = { ...asked[i], answer };
      break;
    }
  }
  session = { ...session, asked, awaiting: null };
  // a size answered once is remembered for this kind of item, for next time
  let remembered = "";
  if (waiting.topic === "size" && answer !== "no preference") {
    const kind = goalKind();
    const size = normalizeSize(answer);
    if (kind && size) {
      saveSize(kind, size);
      remembered = ` I'll remember your ${SIZE_KIND_NAME[kind] || kind} size for next time.`;
    }
  }
  return { question: waiting.question, answer, remembered };
}

// adds what the shopper just said to what tellr knows about the goal. keepItem: they're on an
// item's page, so its photo check stays (it's checked against the new requirement next)
async function saveRequirements(said, { keepItem = false } = {}) {
  const answered = recordAnswer(said);
  const conversation = conversationWith(said, answered);
  const data = await parseRequirements(await getBackendUrl(), conversation.text);
  session = {
    ...session,
    preferences: data.preferences,
    clarificationQuestions: data.clarificationQuestions ?? [],
    requirementsTurns: conversation.turns,
    requirementsText: conversation.text,
    ...(keepItem ? {} : { report: null, review: null, demoOrderId: null }),
  };
  // the kind of item is only known after this first parse: use the usual size now if it isn't
  // already in, and say so once per goal ("I'll use your usual shoe size, 8")
  const usual = usualSizeLine(session.requirementsText);
  if (usual && !session.requirementsText.includes(usual)) session = { ...session, requirementsText: `${usual}\n${session.requirementsText}` };
  const kind = goalKind();
  if (kind && profile.sizes[kind] && session.requirementsText.includes(profileLine(kind, profile.sizes[kind])) && session.sizeNoted !== kind) {
    session = { ...session, sizeNoted: kind, sizeNote: `I'll use your usual ${SIZE_KIND_NAME[kind] || kind} size, ${profile.sizes[kind]}.` };
  }
  return { data, answered };
}

// on an item's page, a new requirement ("they need to be leather"): it's saved, then this item is
// checked against it with its details and photos. fits: stay. doesn't: say why and offer to
// search for ones that do (never leaving without asking). can't tell: stay and say so.
async function runItemRequirement(said) {
  const before = session.preferences;
  await saveRequirements(said, { keepItem: true });
  const prefs = session.preferences;
  const same = (a, b) => a.attribute === b.attribute && a.operator === b.operator && JSON.stringify(a.value) === JSON.stringify(b.value);
  const added = (prefs?.requirements || []).filter((req) => !(before?.requirements || []).some((old) => same(old, req)));
  const page = await extractActivePage({ fresh: true });
  const priceCents = session.listing?.itemPriceCents || page?.itemPriceCents || 0;
  // a budget is plain arithmetic on the item's price, never a judgement
  const overBudget = prefs?.maxTotalCents != null && prefs.maxTotalCents !== before?.maxTotalCents && priceCents > prefs.maxTotalCents;
  if (!added.length && !overBudget) {
    if (prefs?.maxTotalCents != null && prefs.maxTotalCents !== before?.maxTotalCents && priceCents) {
      await finishAnswer(`Saved. This one is ${formatUsd(priceCents)}, within your ${formatUsd(prefs.maxTotalCents)} budget.`, { hint: true });
      return;
    }
    // nothing new to check against (like "for work"): answer about this item with it in mind
    await runExplain(said.slice(0, MAX_QUESTION));
    return;
  }
  let findings = [];
  if (added.length) {
    // the photo check, again, with the new requirement: one status per requirement
    if (!(await runInspect(page || undefined, { readOut: false }))) return;
    findings = added.map((req) => ({ req, assessment: (session.report?.assessments || []).find((a) => a.requirementId === req.id) }));
  }
  const misses = findings.filter((f) => f.assessment?.status === "contradicted");
  const unknown = findings.filter((f) => !f.assessment || f.assessment.status === "unknown");
  const why = (list) => list.map((f) => (f.assessment ? firstSentence(f.assessment.explanation) : `I couldn't check ${requirementLabel(f.req)}.`)).join(" ");
  if (overBudget || misses.length) {
    const reasons = [overBudget ? `It's ${formatUsd(priceCents)}, over your ${formatUsd(prefs.maxTotalCents)} budget.` : "", why(misses)].filter(Boolean).join(" ");
    session = { ...session, pendingSearch: true };
    await finishAnswer(`Saved. This one doesn't fit: ${reasons} Want me to go back and search for ones that do?`);
    return;
  }
  if (unknown.length) {
    await finishAnswer(
      `Saved. I can't tell from this listing: ${why(unknown)} It's worth asking the seller. Say go back to search for ones that list it.`,
    );
    return;
  }
  const claimed = findings.some((f) => f.assessment?.status === "seller_claimed");
  await finishAnswer(`Saved. This one fits${claimed ? ", going by what the seller says" : ""}: ${why(findings)}`, { hint: true });
}

// "yes, search for ones that do": back to the results with the updated search
async function runSearchForFit() {
  session = { ...session, pendingSearch: false };
  const search = buildSearch(session.preferences, session.requirementsText);
  if (!search) {
    await finishAnswer("Tell me what kind of item to search for.");
    return;
  }
  focusOn("");
  session = { ...session, listing: null, report: null, checkout: null, review: null };
  await runSearch(search);
}

// "I'll use your usual shoe size, 8", said once, the first time it's used for a goal
function takeSizeNote() {
  const note = session.sizeNote || "";
  if (note) session = { ...session, sizeNote: "" };
  return note;
}

// "my shoe size is 8": remembered for next time, and used now if that's what's being shopped for
async function runRememberSize(said) {
  const stated = sizeStatement(said);
  const kind = stated?.kind || goalKind(said);
  if (!stated?.size || !kind) {
    await finishAnswer("Which kind of item is that size for? Say it like: my shoe size is 8, or my top size is medium.");
    return;
  }
  saveSize(kind, stated.size);
  const note = `Got it. I'll remember your ${SIZE_KIND_NAME[kind] || kind} size is ${stated.size}.`;
  if (session.preferences && goalKind() === kind) {
    await speak(note);
    await (session.focusKey ? runItemRequirement(said) : runRequirements(said));
    return;
  }
  await finishAnswer(note);
}

async function runRequirements(said) {
  const { data, answered } = await saveRequirements(said);
  // before the first search, learn the basics one question at a time: the kind of item, the
  // size for things you wear, the budget, the style or use. "just search" skips the rest.
  if (!session.interviewDone && !SKIP_ASKING.test(said)) {
    // a question the shopper talked past gets asked once more, before any new one
    const open = session.awaiting?.unanswered ? session.awaiting : null;
    if (open) {
      session = { ...session, awaiting: { topic: open.topic, question: open.question, repeated: true } };
      await finishAnswer(`Got it. And ${open.question.charAt(0).toLowerCase()}${open.question.slice(1)}`);
      return;
    }
    const [topic] = missingBasics(session.preferences, session.requirementsText, session.asked);
    if (topic) {
      const question = (data.clarificationQuestions || []).find((q) => topicOf(q) === topic) || basicQuestion(topic, session.preferences);
      noteQuestion(question);
      const category = String(session.preferences?.category || "");
      const ack = answered ? `Got it: ${answered.answer}.${answered.remembered || ""}` : category && !/^(item|items|something|anything)$/i.test(category) ? `Got it, ${category}.` : "";
      const note = takeSizeNote();
      await finishAnswer(`${ack} ${note} ${question}`.replace(/\s+/g, " ").trim());
      return;
    }
  }
  session = { ...session, interviewDone: true };
  const sizeNote = takeSizeNote();
  if (sizeNote) await speak(sizeNote);
  // with a real item type, go straight to a search and read back what's there
  const search = buildSearch(session.preferences, session.requirementsText);
  if (search) {
    // an answer that doesn't change the search ("casual and classy") re-judges what's already
    // found with that in mind; a new size, color, or budget searches again
    const last = session.lastSearch;
    const sameSearch = last && (sameSearchAs(last, search) || !changesSearch(said));
    if (sameSearch && session.results?.length) {
      session = {
        ...session,
        results: session.results.map((item) => ({ ...item, verdict: undefined, reason: undefined })),
        resultsOffset: 0,
      };
      const heard = answered ? `Got it: ${answered.answer}.` : "Got it.";
      await readResults(`${heard} Let me re-check these with that in mind.`, questionTail(data.clarificationQuestions), "");
      return;
    }
    await runSearch(search, { questions: data.clarificationQuestions ?? [] });
    return;
  }
  const spoken = preferencesSpeech(data.preferences, askable(session.asked, data.clarificationQuestions ?? []).slice(0, 1));
  nextQuestion(data.clarificationQuestions ?? []);
  // on a results page, narrowing the requirements re-screens what's there right away
  const page = await extractActivePage();
  if (page?.pageKind === "results") {
    const results = toResults(namedProducts(page.products || [], page.title));
    if (results.length) {
      const { shown, fitCount } = screenForShopper(results);
      session = { ...session, results: shown, resultsOffset: 0 };
      const count = fitCount
        ? `On this page, ${fitCount} item${fitCount === 1 ? "" : "s"} fit. Say list them to hear them, or compare the top 3.`
        : "None of the items on this page fit yet. Say list them to hear the lowest prices.";
      await finishAnswer(`${spoken} ${count}`);
      return;
    }
  }
  await finishAnswer(spoken, { hint: true });
}

async function runReset() {
  // a new goal, not a new visit: no second welcome, and the shortlist stays
  session = { ...createSession(), voice: session.voice, oriented: session.oriented, shortlist: session.shortlist };
  persist();
  broadcast({ type: "session", session: publicSession(session) });
  await clearPageMarks();
  await finishAnswer("Okay. I dropped the old shopping goal. Tell me what you want, or ask about an item on this page.");
}

// a break, not an ending: silent until the shopper talks again, and nothing is forgotten
async function runPause() {
  await stopSpeaking();
  const line = "Paused. Say resume when you're ready.";
  // not lastSpoken, so "say that again" after a break repeats the real answer
  clearProcessWatchdog();
  setSession({
    paused: true,
    missedWhilePaused: false,
    pendingLeave: false,
    busy: false,
    notice: null,
    lastAnswer: line,
    voice: { status: "idle", transcript: session.voice.transcript },
  });
  void sendOffscreen({ type: "offscreen-tone", name: "paused" }).catch(() => {});
  await speak(line, { evenIfPaused: true });
}

async function runCancel() {
  interruptSpeech();
  clearProcessWatchdog();
  const line = "Okay, cancelled. I still have everything we found.";
  setSession({
    pendingConfirm: null,
    pendingLeave: false,
    lastAnswer: line,
    voice: { status: session.busy ? "processing" : "idle", transcript: session.voice.transcript },
  });
  await speak(line);
}

async function runStatus() {
  const line = session.busy
    ? `I'm here. I'm still ${session.activity || "working on your last request"}.`
    : `I'm here and ready. ${nextHint(session)}`;
  setSession({ lastAnswer: line, voice: { status: session.busy ? "processing" : "idle", transcript: session.voice.transcript } });
  await speak(line);
}

// the welcome: where you are, one question, then the mic opens hands-free
async function welcome() {
  talkHold = false;
  const wasOff = session.off;
  const stored = await chrome.storage.local.get("welcomedOnce").catch(() => ({}));
  setSession({ off: false, paused: false, oriented: true, notice: null, voice: { status: "idle", transcript: "" } });
  const page = await extractActivePage({ fresh: true });
  const text = `${wasOff ? "Tellr is back on. " : ""}${welcomeSpeech(page, session, { firstTime: !stored.welcomedOnce })}`;
  void chrome.storage.local.set({ welcomedOnce: true });
  void sendOffscreen({ type: "offscreen-tone", name: "on" }).catch(() => {});
  session = pushHistory({ ...session, lastAnswer: text, lastSpoken: text }, "assistant", text);
  persist();
  broadcast({ type: "session", session });
  // it ends with a question, so when it finishes the chime plays and the mic opens by itself.
  // pressing the key or saying stop skips it; without speech, the mic stays closed.
  await speakAndWait(text);
}

// "close": finished. silent, mic off, every box and number gone from every page, the side panel
// closed, and this shopping session forgotten. "pause" is the way to stop and come back later.
async function runClose() {
  // silence, the off tone, and a clean page first, before anything that waits
  interruptSpeech();
  session = { ...session, off: true };
  void sendOffscreen({ type: "offscreen-tone", name: "off" }).catch(() => {});
  void clearPageMarks();
  await forceIdle();
  const keys = await shortcutWords();
  // the panel closes, so name a key, not its button
  const toggle = /button/.test(keys.toggle) ? "" : `, or press ${keys.toggle}`;
  const line = `Tellr is closed. Thanks for shopping. To start again, hold ${keys.hold}${toggle}.`;
  // the saved list stays: it's kept for next time, in chrome and convex
  session = { ...createSession(), voice: session.voice, off: true, oriented: false, lastAnswer: line, shortlist: session.shortlist };
  persist();
  broadcast({ type: "session", session: publicSession(session) });
  await speak(line, { evenIfPaused: true });
  // anything that slipped through while turning off
  setTimeout(() => {
    if (session.off) void clearPageMarks();
  }, 1500);
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // chrome 141+; older versions keep the panel open, which is harmless
    if (tab?.windowId != null) await chrome.sidePanel.close?.({ windowId: tab.windowId });
  } catch {
    // the panel was not open
  }
}

// "stop", "I'm done", "I don't need you anymore": quiet at once, then one question with two
// clear answers, so a stray word never ends the session by itself
async function runLeaveAsk() {
  interruptSpeech();
  clearProcessWatchdog();
  session = { ...session, pendingLeave: true, busy: false };
  await finishAnswer("Say pause to come back to this later, or close to finish and clear the page. Which one?");
}

async function runResume() {
  const missed = session.missedWhilePaused && session.lastSpoken;
  session = { ...session, missedWhilePaused: false };
  if (missed) {
    await finishAnswer(`Welcome back. While you were away, I finished this. ${session.lastSpoken}`);
    return;
  }
  const goal = session.preferences?.category ? `We were shopping for ${session.preferences.category}. ` : "";
  await finishAnswer(`Welcome back. ${goal}`, { hint: true });
}

async function runPageQuestion(text, knownPage) {
  const page = knownPage || (await extractActivePage());
  if (!page) {
    await finishAnswer("I need a shopping tab in front. Click the product or results page, then ask again.");
    return;
  }
  session = { ...session, pageUrl: page.url };
  await finishAnswer(answerFromPage(text, page));
}

// readOut false: check the photos and keep the report, without reading it all out. used when
// the shopper asked a question, which is then answered instead. returns true when checked.
async function runInspect(knownPage, { readOut = true } = {}) {
  if (!session.preferences) {
    await finishAnswer("Tell me what you want to buy on this page. For example: running shoes under one hundred dollars.");
    return;
  }
  const page = knownPage || (await extractActivePage());
  if (!page) {
    await finishAnswer("Open a product page, then ask me to inspect it.");
    return;
  }
  if (!page.itemPriceCents && !(page.products || []).some((item) => item.priceCents > 0)) {
    await finishAnswer("I opened this page but could not read a price or product name. Scroll so items and dollar amounts are visible, then ask again.");
    return;
  }
  // a results page mixes many items; inspecting it as one listing would blend their photos
  const choices = toResults(namedProducts(page.products || [], page.title));
  if (page.pageKind === "results" && choices.length > 1) {
    session = { ...session, pageUrl: page.url, results: choices, resultsOffset: 0 };
    await finishAnswer(`This page has ${choices.length} items, so I need to know which one. Say list them to hear them, or say open number 1.`);
    return;
  }
  const images = await listingImagesFromUrls(page.imageUrls || []);
  if (!images.length) {
    await finishAnswer("I couldn't read a product photo on this page. Photos have to come from the listing itself.");
    return;
  }
  const listing = buildListing(page, images);
  void showOnPage({ type: "highlight", page: true });
  // a close photo check takes up to a minute; silence would sound like it broke
  const total = (page.imageUrls || []).length;
  const which = images.length === 1 ? "the photo" : total > images.length ? `the first ${images.length} of ${total} photos` : `all ${images.length} photos`;
  await speak(readOut ? `Looking closely at ${which}. This takes up to a minute.` : `Let me look at ${which} and the listing details. This takes up to a minute.`);
  const report = await inspectListing(await getBackendUrl(), listing, session.preferences);
  session = bumpCheckout(
    {
      ...session,
      pageUrl: page.url,
      listing,
      report,
      review: null,
      demoOrderId: null,
    },
    buildCheckout(page, listing.id, listing.title, listing.itemPriceCents),
  );
  // already described in the list: a reminder, then only what the closer look found
  const known = wasHeard(page.url) ? session.results.find((item) => itemKey(item.url) === itemKey(page.url)) : null;
  const reminder = known ? reminderName(known) : wasHeard(page.url) ? reminderName({ title: listing.title }) : "";
  markHeard([page.url]);
  refreshSaved(page.url, report);
  if (!readOut) return true;
  await finishAnswer(inspectionSpeech(report, { reminder }), { hint: true });
  return true;
}

async function runExplain(question) {
  if (!session.preferences) {
    await runInspect();
    return;
  }
  // not checked yet: check the photos quietly, then answer the question itself
  if (!session.report && !(await runInspect(undefined, { readOut: false }))) return;
  void showOnPage({ type: "highlight", page: true });
  const listing = session.listing
    ? { title: session.listing.title, itemPriceCents: session.listing.itemPriceCents, currency: "USD" }
    : undefined;
  // only what was said about this item: the list readings would pull other options into the answer
  // the item specifics on the page, so the answer uses them together with the photos
  const page = await extractActivePage();
  const answer = await explainListing(await getBackendUrl(), {
    report: session.report,
    preferences: session.preferences,
    question,
    listing,
    history: (session.itemTalk || []).slice(-6),
    details: page?.details || undefined,
  });
  const itemTalk = [...(session.itemTalk || []), { role: "user", text: question.slice(0, 1000) }, { role: "assistant", text: answer.slice(0, 1000) }];
  session = { ...session, itemTalk: itemTalk.slice(-6) };
  await finishAnswer(answer);
}

async function runReview() {
  if (!session.preferences) {
    await finishAnswer("Tell me what you need first, then I can review checkout.");
    return;
  }
  // money check: always read the page now, never the 3s cache, so a just-removed fee isn't missed
  const page = await extractActivePage({ fresh: true });
  if (!page) {
    await finishAnswer("Open the product or checkout page, then ask me to review it.");
    return;
  }
  const selectedListingId = session.listing?.id ?? null;
  if (!selectedListingId) {
    await finishAnswer("Inspect the listing first so I can check that checkout is the same item.");
    return;
  }
  session = bumpCheckout(
    { ...session, pageUrl: page.url },
    buildCheckout(page, selectedListingId, session.listing.title, session.listing.itemPriceCents),
  );
  if (!(session.checkout.unitPriceCents > 0)) {
    await finishAnswer("I couldn't read the item price on this page, so I can't check the total. Open the cart or checkout page with prices showing, then ask again.");
    return;
  }
  const review = await reviewCheckout(await getBackendUrl(), session.preferences, session.checkout, selectedListingId);
  session = { ...session, review, demoOrderId: null, pendingConfirm: null };
  await finishAnswer(review.spokenSummary, { hint: true });
}

async function runConfirm() {
  if (!session.preferences || !session.checkout || !session.review || !session.listing) {
    await finishAnswer("I can only confirm a demo order after the listing is inspected and checkout has passed review.");
    return;
  }
  // re-read the page right now: a fee, add-on, or price that changed since the review voids it
  const page = await extractActivePage({ fresh: true });
  if (!page) {
    await finishAnswer("I can't re-read the checkout page, so I won't confirm. Bring the checkout tab to the front and try again.");
    return;
  }
  session = bumpCheckout(
    { ...session, pageUrl: page.url },
    buildCheckout(page, session.listing.id, session.listing.title, session.listing.itemPriceCents),
  );
  if (!session.review || session.review.checkoutVersion !== session.checkout.version) {
    await finishAnswer("The checkout changed since I reviewed it, so I won't confirm. Ask me to review checkout again.");
    return;
  }
  if (session.review.overall !== "pass") {
    await finishAnswer(session.review.spokenSummary || "Checkout has not passed review, so I will not confirm.");
    return;
  }
  // two steps: read back exactly what would be confirmed, then wait for a clear yes
  const pending = session.pendingConfirm;
  const consented =
    pending && pending.version === session.checkout.version && Date.now() - pending.at < PENDING_CONFIRM_MS;
  if (!consented) {
    session = { ...session, pendingConfirm: { version: session.checkout.version, at: Date.now() } };
    const total = session.review.totalCents != null ? formatUsd(session.review.totalCents) : "a total I couldn't read";
    await finishAnswer(
      `Before I confirm: this is a demo order for ${session.listing.title.slice(0, 80)}, total ${total}. It's not a real purchase and uses no payment. Say yes, confirm to go ahead, or say cancel.`,
    );
    return;
  }
  session = { ...session, pendingConfirm: null };
  const result = await confirmDemoOrder(
    await getBackendUrl(),
    session.preferences,
    session.checkout,
    session.listing.id,
    session.review.checkoutVersion,
  );
  session = { ...session, demoOrderId: result.demoOrderId };
  await finishAnswer(`Demo order ${result.demoOrderId} recorded. No real purchase was made, and no payment details were used.`, { hint: true });
}

let lastExtract = { at: 0, url: "", page: null };

async function extractActivePage({ fresh = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return null;
  if (!fresh && lastExtract.page && lastExtract.url === tab.url && Date.now() - lastExtract.at < 3000) return lastExtract.page;
  const page = await extractTab(tab.id);
  if (page) lastExtract = { at: Date.now(), url: tab.url, page };
  return page;
}

// reads any tab, including the hidden ones used to compare items
async function extractTab(tabId, timeoutMs = 4000) {
  const read = async () => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["extract-page.js"] });
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis.TellrExtract ? globalThis.TellrExtract.extractPage() : null),
    });
    return injected?.result ?? null;
  };
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("extract timeout")), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

// hint: end with one short "say ... next" suggestion for the current step
async function finishAnswer(text, { hint = false } = {}) {
  const spoken = clipForSpeech(hint ? `${text.trim()} ${nextHint(session)}` : text);
  session = pushHistory({ ...session, lastAnswer: spoken, lastSpoken: spoken, notice: null }, "assistant", spoken);
  persist();
  broadcast({ type: "session", session });
  await speak(spoken);
}

function voiceUnconfigured(message) {
  return /voice is not configured/i.test(String(message || ""));
}

// say it out loud too: a blind user can't see the "didn't catch that" notice
async function notHeard() {
  // a first press with nothing said: they may not know what to say, so welcome them instead
  if (!session.oriented) {
    void welcome();
    return;
  }
  const message = "I didn't catch that. Try again, or say help.";
  setSession({ voice: { status: "idle", transcript: "" }, notice: message, lastAnswer: message });
  await speak(message);
}

async function fail(message) {
  clearProcessWatchdog();
  setSession({
    busy: false,
    notice: message,
    voice: { status: "idle", transcript: session.voice.transcript },
    lastAnswer: message,
    lastSpoken: message,
  });
  // a low tone first, so a failure never sounds like an ordinary answer
  void sendOffscreen({ type: "offscreen-tone", name: "error" }).catch(() => {});
  // don't call /api/voice/speak to read an error that says voice isn't configured
  if (voiceUnconfigured(message)) return;
  await speak(message);
}

// bumped by stop-speaking so audio still being fetched doesn't start playing afterwards
let speechGen = 0;

function interruptSpeech() {
  speechGen += 1;
  try {
    chrome.tts?.stop();
  } catch {
    // no backup voice playing
  }
  readingGen += 1;
  endCaption();
  speechFinished();
  // stopping shouldn't create the offscreen page just to silence nothing
  try {
    audioPort?.postMessage({ type: "offscreen-stop-speech" });
  } catch {
    // offscreen is already gone
  }
}

async function stopSpeaking() {
  interruptSpeech();
  setSession({ voice: { status: "idle", transcript: session.voice.transcript } });
}

// resolved when the offscreen page says playback finished (or was stopped)
let speechDoneWaiters = [];
function speechFinished() {
  const waiters = speechDoneWaiters;
  speechDoneWaiters = [];
  for (const resolve of waiters) resolve();
}

// speaks and waits for the audio to end, so the next item's box lines up with its words
async function speakAndWait(text) {
  const job = queueSpeech(text);
  if (!(await job.started)) return false;
  await job.done;
  return true;
}

// the words being spoken, shown as a live caption once the audio starts
let caption = null;

// audio length from the player; a speaking-rate guess if it isn't known yet
function captionDuration(text, durationSec) {
  if (Number.isFinite(durationSec) && durationSec > 0) return Math.round(durationSec * 1000);
  return Math.max(1500, text.split(/\s+/).length * 380);
}

function endCaption() {
  if (!caption) return;
  caption = null;
  broadcast({ type: "caption-end" });
}

// speech plays in order: a new line waits for the one before it instead of cutting it off.
// only the shopper interrupts: stop speaking, pause, off, or starting to talk (they bump speechGen).
// long answers go out a sentence or two at a time, so speech starts sooner and never times out.
let speechTail = Promise.resolve();

function waitForSpeechDone() {
  return new Promise((resolve) => {
    speechDoneWaiters.push(resolve);
    setTimeout(resolve, 90_000);
  });
}

// evenIfPaused: only the "paused" and "off" lines are spoken while tellr is quiet
function queueSpeech(text, { evenIfPaused = false } = {}) {
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const gen = speechGen;
  let spoke = false;
  const job = speechTail.then(async () => {
    if ((session.paused || session.off) && !evenIfPaused) {
      // work that finishes during a break stays on screen and waits for "resume"
      if (session.paused) setSession({ missedWhilePaused: true });
      return;
    }
    const settings = await getSettings();
    if (!settings.speakAnswers || gen !== speechGen) {
      if (!settings.speakAnswers) setSession({ voice: { status: "idle", transcript: session.voice.transcript } });
      return;
    }
    const backend = await getBackendUrl();
    const chunks = speechChunks(speakablePrices(clipForSpeech(text)));
    const audio = [];
    const fetchChunk = (i) => (audio[i] ??= fetchSpeech(backend, chunks[i]));
    let i = 0;
    try {
      await ensureOffscreen();
      for (; i < chunks.length; i += 1) {
        const bytes = await fetchChunk(i);
        // fetch the next part while this one plays, so there's no gap
        if (i + 1 < chunks.length) fetchChunk(i + 1).catch(() => {});
        if (gen !== speechGen) return;
        caption = { text: chunks[i] };
        setSession({ voice: { status: "speaking", transcript: session.voice.transcript } });
        const done = waitForSpeechDone();
        await sendOffscreen({ type: "offscreen-speak", audioBase64: arrayBufferToBase64(bytes) });
        spoke = true;
        started(true);
        await done;
        if (gen !== speechGen) return;
      }
    } catch (error) {
      if (gen !== speechGen) return;
      // cartesia couldn't speak (out of credits, offline, slow): never go silent. chrome's own
      // voice says the rest, and says once why it sounds different
      const reason = error instanceof ApiError ? error.message : "Speech didn't play.";
      setSession({ voice: { status: "idle", transcript: session.voice.transcript }, notice: `${reason} The answer is shown in the side panel.` });
      const why = backupVoiceExplained ? "" : "My main voice isn't working right now, so I'm using a backup voice. ";
      backupVoiceExplained = true;
      spoke = true;
      started(true);
      await backupSpeak(`${why}${chunks.slice(i).join(" ")}`);
    }
  });
  const finished = job
    .catch(() => {})
    .finally(() => started(false))
    .then(() => {
      // the last thing tellr had to say, fully played and not cut off: it's the shopper's turn
      if (spoke && gen === speechGen && speechTail === finished) yourTurn(text);
    });
  speechTail = finished;
  return { started: startedPromise, done: finished };
}

let backupVoiceExplained = false;

// chrome's built-in voice, only when cartesia can't speak
function backupSpeak(text) {
  return new Promise((resolve) => {
    try {
      chrome.tts.speak(text, {
        rate: 1.05,
        onEvent: (event) => {
          if (["end", "interrupted", "cancelled", "error"].includes(event.type)) resolve();
        },
      });
    } catch {
      resolve();
    }
    setTimeout(resolve, 90_000);
  });
}

// tellr finished talking and has nothing more to say or do: one bright chime means "your turn".
// after a question ("what size?"), the mic then opens by itself, so the shopper just answers;
// it closes on its own when they stop talking.
function yourTurn(spokenText) {
  if (session.busy || session.off || session.paused || talkHold || session.voice.status === "listening") return;
  void sendOffscreen({ type: "offscreen-tone", name: "turn" }).catch(() => {});
  if (!/\?["')\s]*$/.test(String(spokenText || "").trim())) return;
  holdMode = "toggle";
  void enqueue(() => (talkHold ? undefined : startTalk()));
}

// resolves true once the words start playing, false if they were skipped or stopped
function speak(text, options) {
  return queueSpeech(text, options).started;
}

// a sentence or two per request: the first part is short so tellr starts talking quickly
function speechChunks(text) {
  // split only where a sentence ends and a space follows, so "99.6" or "4.5" stays whole
  const sentences = text.split(/(?<=[.!?]["')\]]*)\s+/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    const last = chunks.at(-1);
    const size = (last?.length ?? 0) + sentence.length;
    // the first part stays short (a sentence, or two tiny ones) so speech starts fast; later
    // parts gather sentences up to about 320 characters
    const join = chunks.length > 1 ? size < 320 : chunks.length === 1 && last.length < 60 && size < 160;
    if (join) chunks[chunks.length - 1] = `${last} ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

function setSession(patch) {
  session = { ...session, ...patch, voice: patch.voice ?? session.voice };
  persist();
  broadcast({ type: "session", session });
}

function persist() {
  void chrome.storage.session.set({ session: publicSession(session) });
}

// the soft working tick plays while tellr is busy and not talking
function syncWorkingSound() {
  const want = (Boolean(session.busy) || session.voice.status === "processing") && session.voice.status !== "speaking" && !session.off && !session.paused;
  if (want === workingSound) return;
  workingSound = want;
  try {
    audioPort?.postMessage({ type: "offscreen-working", on: want });
  } catch {
    // offscreen is gone, so nothing is ticking
  }
}

function broadcast(message) {
  if (message.type === "session") syncWorkingSound();
  const payload = message.type === "session" ? { ...message, session: publicSession(message.session) } : message;
  chrome.runtime.sendMessage(payload).catch(() => {});
  try {
    holdPort?.postMessage(payload);
  } catch {
    // the hold port closed
  }
  if (holdTabId != null) chrome.tabs.sendMessage(holdTabId, payload).catch(() => {});
}
