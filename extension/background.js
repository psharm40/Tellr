// service worker: talks to the tellr backend. keys stay on the server.
import { ApiError, confirmDemoOrder, explainListing, fetchSpeech, inspectListing, parseRequirements, probeTellrBackend, reviewCheckout } from "./lib/api.js";
import { clipForSpeech, inspectionSpeech, preferencesSpeech } from "./lib/format.js";
import { listingImagesFromUrls } from "./lib/images.js";
import { classifyIntent } from "./lib/intent.js";
import { answerFromPage, buildCheckout, buildListing } from "./lib/page.js";
import { bumpCheckout, createSession, forgetStaleGoal, pushHistory } from "./lib/session.js";
import { getBackendUrl, getSettings } from "./lib/settings.js";

const MAX_REQUIREMENTS = 2000;
const MAX_QUESTION = 500;

let session = createSession();
let creatingOffscreen = null;
let talkHold = false;
let talkGen = 0;
let holdTabId = null;
let holdSeen = 0;
let lastLevelAt = 0;
let listenWatchdog = null;
let processWatchdog = null;

setInterval(() => {
  if (talkHold && Date.now() - holdSeen > 3000) void enqueue(() => stopTalk());
}, 500);

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) void chrome.sidePanel.open({ tabId: tab.id });
});

let chain = Promise.resolve();
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
  switch (message?.type) {
    case "get-session":
      return { session: publicSession(session) };
    case "get-settings":
      return { settings: await getSettings() };
    case "talk-start":
      holdTabId = sender?.tab?.id ?? holdTabId;
      holdSeen = Date.now();
      await enqueue(() => startTalk());
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
    case "typed":
      await handleTranscript(String(message.text || ""));
      return {};
    case "stt-event":
      await onSttEvent(message.event, message.gen);
      return {};
    case "inspect-now":
      await runInspect();
      return {};
    case "review-now":
      await runReview();
      return {};
    case "confirm-now":
      await runConfirm();
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
    if (message?.type === "offscreen-speak-done") {
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

function publicSession(current) {
  if (!current.listing) return current;
  return {
    ...current,
    listing: {
      ...current.listing,
      images: current.listing.images.map((image) => ({
        id: image.id,
        url: image.url.startsWith("data:") ? "" : image.url,
        alt: image.alt,
      })),
    },
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
      setSession({
        voice: { status: "idle", transcript: "" },
        notice: "I didn't catch that. Hold the shortcut and try again, or type.",
      });
    }
  }, 15_000);
}

async function startTalk() {
  const gen = ++talkGen;
  talkHold = true;
  clearProcessWatchdog();
  setSession({ voice: { status: "listening", transcript: "", level: 0 }, notice: null, busy: false });
  clearListenWatchdog();
  listenWatchdog = setTimeout(() => {
    if (talkGen === gen && session.voice.status === "listening") void enqueue(() => stopTalk());
  }, 20_000);
  try {
    await sendOffscreen({ type: "offscreen-start", gen });
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
  if (event.type === "level") {
    const now = Date.now();
    if (!talkHold || now - lastLevelAt < 200) return;
    lastLevelAt = now;
    setSession({ voice: { status: "listening", transcript: session.voice.transcript, level: event.level } });
    return;
  }
  if (event.type === "partial") {
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
    setSession({ voice: { status: "idle", transcript: "" }, notice: "I didn't catch that. Hold the shortcut and try again, or type." });
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
    setSession({ voice: { status: "idle", transcript: "" }, notice: "I didn't catch that. Hold the shortcut and try again, or type." });
    return;
  }
  setSession({ busy: true, notice: null, voice: { status: "processing", transcript: text }, lastAnswer: "" });
  session = pushHistory(session, "user", text.slice(0, 1000));
  persist();
  try {
    const page = await extractActivePage();
    session = forgetStaleGoal(session, page, text);
    persist();
    const intent = classifyIntent(text, session);
    if (intent === "reset") await runReset();
    else if (intent === "confirm") await runConfirm();
    else if (intent === "review") await runReview();
    else if (intent === "page") await runPageQuestion(text, page);
    else if (intent === "inspect") await runInspect(page);
    else if (intent === "explain") await runExplain(text.slice(0, MAX_QUESTION));
    else await runRequirements(text);
  } catch (error) {
    await fail(error instanceof ApiError ? error.message : error.message || "Something went wrong.");
  } finally {
    setSession({ busy: false, voice: { status: session.voice.status === "speaking" ? "speaking" : "idle", transcript: session.voice.transcript } });
  }
}

async function runRequirements(text) {
  const data = await parseRequirements(await getBackendUrl(), text);
  session = {
    ...session,
    preferences: data.preferences,
    clarificationQuestions: data.clarificationQuestions ?? [],
    report: null,
    review: null,
    demoOrderId: null,
  };
  const spoken = preferencesSpeech(data.preferences, data.clarificationQuestions ?? []);
  await finishAnswer(spoken);
}

async function runReset() {
  session = { ...createSession(), voice: session.voice };
  persist();
  broadcast({ type: "session", session: publicSession(session) });
  await finishAnswer("Okay. I dropped the old shopping goal. Tell me what you want, or ask about an item on this page.");
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
  const images = await listingImagesFromUrls(page.imageUrls || []);
  if (!images.length) {
    await finishAnswer("I couldn't read a product photo on this page. Photos have to come from the listing itself.");
    return;
  }
  const listing = buildListing(page, images);
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
    buildCheckout(page, listing.id, listing.title),
  );
  await finishAnswer(inspectionSpeech(report));
}

async function runExplain(question) {
  if (!session.report || !session.preferences) {
    await runInspect();
    return;
  }
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
  const page = await extractActivePage();
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
    buildCheckout(page, selectedListingId, session.listing.title),
  );
  const review = await reviewCheckout(await getBackendUrl(), session.preferences, session.checkout, selectedListingId);
  session = { ...session, review, demoOrderId: null };
  await finishAnswer(review.spokenSummary);
}

async function runConfirm() {
  if (!session.preferences || !session.checkout || !session.review || !session.listing) {
    await finishAnswer("I can only confirm a demo order after the listing is inspected and checkout has passed review.");
    return;
  }
  if (session.review.overall !== "pass") {
    await finishAnswer(session.review.spokenSummary || "Checkout has not passed review, so I will not confirm.");
    return;
  }
  const result = await confirmDemoOrder(
    await getBackendUrl(),
    session.preferences,
    session.checkout,
    session.listing.id,
    session.review.checkoutVersion,
  );
  session = { ...session, demoOrderId: result.demoOrderId };
  await finishAnswer(`Demo order ${result.demoOrderId} recorded. No real purchase was made, and no payment details were used.`);
}

let lastExtract = { at: 0, url: "", page: null };

async function extractActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return null;
  if (lastExtract.page && lastExtract.url === tab.url && Date.now() - lastExtract.at < 3000) return lastExtract.page;
  const read = async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract-page.js"] });
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis.TellrExtract ? globalThis.TellrExtract.extractPage() : null),
    });
    return injected?.result ?? null;
  };
  try {
    const page = await Promise.race([
      read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("extract timeout")), 4000)),
    ]);
    lastExtract = { at: Date.now(), url: tab.url, page };
    return page;
  } catch {
    return null;
  }
}

async function finishAnswer(text) {
  const spoken = clipForSpeech(text);
  session = pushHistory({ ...session, lastAnswer: spoken, notice: null }, "assistant", spoken);
  persist();
  broadcast({ type: "session", session });
  await speak(spoken);
}

function voiceUnconfigured(message) {
  return /voice is not configured/i.test(String(message || ""));
}

async function fail(message) {
  clearProcessWatchdog();
  setSession({ busy: false, notice: message, voice: { status: "idle", transcript: session.voice.transcript }, lastAnswer: message });
  // don't call /api/voice/speak to read an error that says voice isn't configured
  if (voiceUnconfigured(message)) return;
  await speak(message);
}

async function speak(text) {
  const settings = await getSettings();
  if (!settings.speakAnswers) {
    setSession({ voice: { status: "idle", transcript: session.voice.transcript } });
    return;
  }
  try {
    await ensureOffscreen();
    const audio = await fetchSpeech(await getBackendUrl(), clipForSpeech(text));
    setSession({ voice: { status: "speaking", transcript: session.voice.transcript } });
    await sendOffscreen({ type: "offscreen-speak", audioBase64: arrayBufferToBase64(audio) });
  } catch {
    setSession({ voice: { status: "idle", transcript: session.voice.transcript } });
  }
}

function setSession(patch) {
  session = { ...session, ...patch, voice: patch.voice ?? session.voice };
  persist();
  broadcast({ type: "session", session });
}

function persist() {
  void chrome.storage.session.set({ session: publicSession(session) });
}

function broadcast(message) {
  const payload = message.type === "session" ? { ...message, session: publicSession(message.session) } : message;
  chrome.runtime.sendMessage(payload).catch(() => {});
  try {
    holdPort?.postMessage(payload);
  } catch {
    // the hold port closed
  }
  if (holdTabId != null) chrome.tabs.sendMessage(holdTabId, payload).catch(() => {});
}
