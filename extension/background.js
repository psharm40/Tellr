// service worker: talks to the tellr backend. keys stay on the server.
import { ApiError, chooseItems, confirmDemoOrder, describeItems, explainListing, judgeItems, fetchSpeech, inspectListing, parseRequirements, probeTellrBackend, reviewCheckout } from "./lib/api.js";
import {
  speakablePrices,
  checkoutAnswer,
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
  spokenName,
} from "./lib/format.js";
import { listingImagesFromUrls, thumbnailFor } from "./lib/images.js";
import { MAX_COMPARE, classifyIntent, parseCompareList, parseItemNumber, parseSiteSearch } from "./lib/intent.js";
import { keywordsFrom, priceBounds, screenResults, screeningSummary } from "./lib/screen.js";
import { SITE_NAME, buildSearch, changesSearch, describeSearch, sameSearch as sameSearchAs, searchUrl, siteOf } from "./lib/search.js";
import { answerFromPage, buildCheckout, buildListing, namedProducts } from "./lib/page.js";
import { bumpCheckout, createSession, forgetStaleGoal, pushHistory } from "./lib/session.js";
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
  .catch(() => {});
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
    void enqueue(() => toggleTalk());
  }
});

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
  if (early === "off") {
    await runOff();
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
    persist();
    // whether a single item's page is open decides where "how's the wear on it?" goes
    const intent = classifyIntent(text, { ...session, paused: wasPaused, onListing: page?.pageKind === "listing" });
    setSession({ activity: ACTIVITY[intent.split(":")[0]] || "working on that" });
    // any other answer to "are you done shopping?" means keep going
    if (!intent.startsWith("end")) session = { ...session, pendingEnd: false };
    // the listing's seller, popularity, returns... for the side panel
    if (page) session = { ...session, facts: page.facts ?? null };
    if (intent === "resume") await runResume();
    else if (intent === "end") await runEnd();
    else if (intent === "end-confirm") await runEndConfirm();
    else if (intent === "end-cancel") {
      session = { ...session, pendingEnd: false };
      await finishAnswer("Okay, I'll keep everything.", { hint: true });
    }
    else if (intent === "help") await runHelp();
    else if (intent === "where") await finishAnswer(placeSpeech(page), { hint: true });
    else if (intent === "repeat") await runRepeat();
    else if (intent === "cancel-confirm") await runCancelConfirm();
    else if (intent === "reset") await runReset();
    else if (intent === "find") await runFind(text, parseSiteSearch(text));
    else if (intent === "list") await runList(page);
    else if (intent === "more") await runMore();
    else if (intent === "buy") await runBuy();
    else if (intent === "checkout-question") await finishAnswer(checkoutAnswer(text, session.checkout, session.review));
    else if (intent.startsWith("facts:")) {
      const topic = intent.slice(6);
      await finishAnswer(factsSpeech(page?.facts, topic === "all" ? null : topic, session.preferences));
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
    else if (intent === "inspect") await runInspect(page);
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
  const toggle = commands.find((c) => c.name === "toggle-listening")?.shortcut;
  return {
    hold: spokenKeys(formatHoldKey(settings.holdKey, mac)),
    toggle: toggle ? spokenKeys(toggle) : "the Start listening button in the side panel",
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
function itemLine(item, number) {
  const verdict = VERDICT_WORDS[item.verdict];
  const what = (item.description || item.title).replace(/\s*$/, "").replace(/([^.!?])$/, "$1.");
  return `Number ${number}, ${formatUsd(item.priceCents)}${verdict ? `, ${verdict}` : ""}: ${what}${item.reason ? ` ${item.reason}` : ""}`;
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
  return questions?.length ? ` One question: ${questions[0]}` : "";
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
  const question = tail.includes("One question:") ? "" : session.followUp ? ` ${session.followUp}` : "";
  const closing = `Say open and a number, or compare them.${question}${tail.replace(" You can also say compare the top 3.", "")}`;
  await announce(
    picks.map((item, i) => itemLine(item, i + 1)),
    picks.map((_, i) => i + 1),
    closing,
  );
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
  await announce(
    next.map((item, i) => itemLine(item, numbers[i])),
    numbers,
    left > 0 ? "Say more for others, or open a number." : "That's all I can read here. Say open and a number to pick one.",
  );
}

async function runOpen(number) {
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
      ? `Opening number ${number}, ${spokenName(item)}, ${formatUsd(item.priceCents)}. I already checked its photos. Ask me anything about it, like how worn it is, or go to checkout and say review checkout.`
      : `Opening number ${number}, ${spokenName(item)}, ${formatUsd(item.priceCents)}. When it loads, ask me how it looks or how worn it is, or say check this item.`,
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
  const ask = questions.length ? ` One question: ${questions[0]}` : "";
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
  if (!checked.length) {
    await finishAnswer(`I couldn't check those items. ${failed.map((f) => `Number ${f.number}: ${f.reason}.`).join(" ")}`);
    return;
  }
  const missed = failed.map((f) => `I couldn't check number ${f.number}: ${f.reason}.`).join(" ");
  // a fair, human ranking for the price; the mechanical summary is only a fallback
  try {
    const judged = await judgeItems(backendUrl, {
      items: checked.map(({ number, title, priceCents, report }) => ({ number, title, priceCents, report })),
      preferences: session.preferences,
      notes: session.requirementsText || undefined,
    });
    const byNumber = new Map(checked.map((entry) => [entry.number, entry]));
    const order = judged.ranking.map((r) => r.number);
    session = { ...session, focusNumbers: order };
    const lines = judged.ranking.map(
      (r, i) =>
        `${i === 0 ? "Best" : "Next"}: number ${r.number}, ${formatUsd(byNumber.get(r.number).priceCents)}, ${VERDICT_WORDS[r.verdict]}. ${r.summary}`,
    );
    const closing = [missed, `Say open number ${order[0]} to go to it.`, judged.followUp].filter(Boolean).join(" ");
    await announce(lines, order, closing);
  } catch {
    const best = [...checked].sort((a, b) => fitScore(b.report) - fitScore(a.report) || a.priceCents - b.priceCents)[0];
    if (best) glowResults([best.number]);
    await finishAnswer(compareSpeech(checked, failed, session.preferences.requirements));
  }
}

// the requirements route rejects more than 2000 characters
const MAX_CONVERSATION_CHARS = 1900;

// everything the shopper has said about the current goal, so claude never forgets an earlier
// answer (budget, size) when asking its next question. a new goal ("start over", or a different
// kind of item, which clears the preferences) starts a fresh conversation.
function conversationWith(next) {
  const turns = session.preferences ? [...(session.requirementsTurns || []), next] : [next];
  const render = (list) => list.map((turn, i) => (i === 0 ? turn : `Then the shopper said: ${turn}`)).join("\n");
  // keep the first request and as many of the latest answers as fit
  let kept = turns;
  while (kept.length > 2 && render(kept).length > MAX_CONVERSATION_CHARS) kept = [kept[0], ...kept.slice(2)];
  const text = render(kept);
  return { turns: kept, text: text.length > MAX_CONVERSATION_CHARS ? text.slice(-MAX_CONVERSATION_CHARS) : text };
}

async function runRequirements(said) {
  const conversation = conversationWith(said);
  const data = await parseRequirements(await getBackendUrl(), conversation.text);
  session = {
    ...session,
    preferences: data.preferences,
    clarificationQuestions: data.clarificationQuestions ?? [],
    requirementsTurns: conversation.turns,
    requirementsText: conversation.text,
    report: null,
    review: null,
    demoOrderId: null,
  };
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
      await readResults("Got it. Let me re-check these with that in mind.", questionTail(data.clarificationQuestions), "");
      return;
    }
    await runSearch(search, { questions: data.clarificationQuestions ?? [] });
    return;
  }
  const spoken = preferencesSpeech(data.preferences, data.clarificationQuestions ?? []);
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
  // a new goal, not a new visit: no second welcome
  session = { ...createSession(), voice: session.voice, oriented: session.oriented };
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
    pendingEnd: false,
    busy: false,
    notice: null,
    lastAnswer: line,
    voice: { status: "idle", transcript: session.voice.transcript },
  });
  await speak(line, { evenIfPaused: true });
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
  const gen = speechGen;
  const played = await speakAndWait(text);
  // pressing the key again or saying stop skips the rest; without speech, don't open the mic
  if (!played || gen !== speechGen) return;
  holdMode = "toggle";
  void enqueue(() => startTalk());
}

// "shut up and close": silent, mic off, page marks gone, panel closed. memory stays, so turning
// it back on picks up where you left off; only "i'm done shopping" clears it.
async function runOff() {
  // silence, the off tone, and a clean page first, before anything that waits
  interruptSpeech();
  session = { ...session, off: true };
  void sendOffscreen({ type: "offscreen-tone", name: "off" }).catch(() => {});
  void clearPageMarks();
  await forceIdle();
  const keys = await shortcutWords();
  // the panel closes, so name a key, not its button
  const toggle = /button/.test(keys.toggle) ? "" : `, or press ${keys.toggle}`;
  const line = `Tellr is off. To turn me back on, hold ${keys.hold}${toggle}.`;
  setSession({ off: true, paused: false, oriented: false, pendingEnd: false, lastAnswer: line });
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

// clearing can't be undone, so check first; a quick "pause" is offered as the other way out
async function runEnd() {
  const nothingSaved = !session.preferences && !session.results?.length && !session.listing;
  if (nothingSaved) {
    await runEndConfirm();
    return;
  }
  session = { ...session, pendingEnd: true };
  await finishAnswer(
    "Are you done shopping for today? Say yes and I'll clear everything we found. Say no to keep going, or pause if you just need a break.",
  );
}

async function runEndConfirm() {
  // a new goal, not a new visit: no second welcome
  session = { ...createSession(), voice: session.voice, oriented: session.oriented };
  persist();
  broadcast({ type: "session", session: publicSession(session) });
  await clearPageMarks();
  await finishAnswer("All cleared. Thanks for shopping with Tellr. Whenever you want to shop again, just tell me what you're looking for.");
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

async function runInspect(knownPage) {
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
  await speak(`Looking closely at ${which}. This takes up to a minute.`);
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
  await finishAnswer(inspectionSpeech(report), { hint: true });
}

async function runExplain(question) {
  if (!session.report || !session.preferences) {
    await runInspect();
    return;
  }
  void showOnPage({ type: "highlight", page: true });
  const listing = session.listing
    ? { title: session.listing.title, itemPriceCents: session.listing.itemPriceCents, currency: "USD" }
    : undefined;
  const answer = await explainListing(await getBackendUrl(), {
    report: session.report,
    preferences: session.preferences,
    question,
    listing,
    history: session.history,
  });
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
  const spoken = clipForSpeech(hint ? `${text} ${nextHint(session)}` : text);
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
      started(true);
      await backupSpeak(`${why}${chunks.slice(i).join(" ")}`);
    }
  });
  const finished = job.catch(() => {}).finally(() => started(false));
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
