import { CHECK_STATUS, EVIDENCE_STATUS, FACT_TOPICS, OVERALL, PAGE_KEYS, PRESENCE, reminderName, budgetText, describeRequirement, formatUsd, presenceOf, ruleLabel } from "./lib/format.js";
import { formatHoldKey, getSettings } from "./lib/settings.js";
import { playCaption } from "./lib/caption.js";

const $ = (id) => document.getElementById(id);
const live = $("live");
const answerEl = $("answer");
// answers spoken aloud stay visible but out of the live region, so screen readers don't repeat them
let speakAnswers = true;
const prefsEl = $("prefs");
const resultsEl = $("results");
const listingEl = $("listing");
const checkoutEl = $("checkout");
const confirmCopy = $("confirm-copy");
const confirmBtn = $("confirm");
const cancelBtn = $("cancel-confirm");
const listenBtn = $("listen");
const moreBtn = $("more");
const pauseBtn = $("pause");
const captionEl = $("caption");
let stopCaption = () => {};
let paused = false;

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

$("ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("ask").value.trim();
  if (!text) return;
  send("typed", { text });
  $("ask").value = "";
});

// every voice command also has a button, so nothing depends on remembering what to say
listenBtn.addEventListener("click", () => send("talk-toggle"));
$("stop-speaking").addEventListener("click", () => {
  send("stop-speaking");
  live.textContent = "Stopped speaking.";
});
// pausing keeps every result and answer; only "i'm done shopping" clears them
pauseBtn.addEventListener("click", () => send(paused ? "resume-now" : "pause-now"));
$("help").addEventListener("click", () => send("help-now"));
$("repeat").addEventListener("click", () => send("repeat-now"));
$("list").addEventListener("click", () => send("list-now"));
moreBtn.addEventListener("click", () => send("more-now"));
$("compare").addEventListener("click", () => send("compare-now"));
$("inspect").addEventListener("click", () => send("inspect-now"));
$("review").addEventListener("click", () => send("review-now"));
confirmBtn.addEventListener("click", () => send("confirm-now"));
cancelBtn.addEventListener("click", () => send("cancel-confirm"));
$("saved").addEventListener("click", (event) => {
  const open = event.target.closest("button[data-open-saved]");
  const remove = event.target.closest("button[data-remove-saved]");
  if (open) send("open-saved", { number: Number(open.dataset.openSaved) });
  if (remove) send("remove-saved", { number: Number(remove.dataset.removeSaved) });
});
resultsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-number]");
  if (button) send("open-result", { number: Number(button.dataset.number) });
});
$("shortcuts-link").addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "session") render(message.session);
  if (message?.type === "caption") showCaption(message.text, message.durationMs);
  if (message?.type === "caption-end") hideCaption();
});

function showCaption(text, durationMs) {
  stopCaption();
  captionEl.hidden = false;
  stopCaption = playCaption(text, durationMs, (shown) => {
    captionEl.textContent = shown;
  });
}

function hideCaption() {
  stopCaption();
  captionEl.hidden = true;
  captionEl.textContent = "";
}

chrome.runtime.sendMessage({ type: "get-session" }, (response) => {
  if (response?.session) render(response.session);
});

const mac = navigator.platform.toUpperCase().includes("MAC");
Promise.all([getSettings(), chrome.commands.getAll().catch(() => [])]).then(([settings, commands]) => {
  speakAnswers = settings.speakAnswers;
  const shortcut = (name) => commands.find((c) => c.name === name)?.shortcut;
  const toggle = shortcut("toggle-listening");
  const open = shortcut("open-tellr");
  // every key, as chrome has them set now; the page keys are option+shift and a letter
  const optionShift = mac ? "Option+Shift+" : "Alt+Shift+";
  const rows = [
    [formatHoldKey(settings.holdKey, mac), "hold and talk"],
    [shortcut("toggle-listening"), "start or stop listening"],
    [shortcut("stop-speaking"), "stop talking"],
    [shortcut("open-tellr"), "open this panel"],
    [shortcut("close-tellr"), "close Tellr and clear the page (press twice)"],
    ...PAGE_KEYS.map(([letter, what]) => [`${optionShift}${letter}`, `${what} (on a shopping page)`]),
  ].filter(([keys]) => keys);
  $("shortcut-list").innerHTML = rows.map(([keys, what]) => `<li><strong>${escapeHtml(keys)}</strong>: ${escapeHtml(what)}</li>`).join("");
  $("shortcut").textContent = [
    `On a shopping page, hold ${formatHoldKey(settings.holdKey, mac)} and talk.`,
    toggle ? `Or press ${toggle} anywhere in Chrome to start, and again to stop.` : "",
    open ? `${open} opens this panel.` : "",
    "You'll hear a rising tone when I'm listening.",
  ]
    .filter(Boolean)
    .join(" ");
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.speakAnswers) speakAnswers = changes.speakAnswers.newValue !== false;
});

function render(session) {
  const voice = session.voice || {};
  const text = session.notice || session.lastAnswer || voice.transcript || "";
  answerEl.textContent = text;
  live.textContent = speakAnswers ? "" : text;

  // the shortlist as a table, so a screen reader can move by row and hear each column's name
  const saved = session.shortlist || [];
  const FIT = { great_pick: "Great pick", good_pick: "Good pick", okay_pick: "Okay pick", risky: "Risky", not_a_match: "Not a match" };
  $("saved").innerHTML = saved.length
    ? `<table class="saved"><caption class="muted">${saved.length} saved</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Price</th><th scope="col">Fit</th><th scope="col">What to know</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${saved
          .map((entry, i) => {
            const name = reminderName(entry).replace(/^the /, "");
            const note = entry.flaw || (entry.unknown ? `Unknown: ${entry.unknown}` : "");
            return `<tr><th scope="row">${i + 1}. ${escapeHtml(name)}</th><td>${escapeHtml(formatUsd(entry.priceCents))}</td><td>${escapeHtml(FIT[entry.fit] || "Not judged yet")}</td><td>${escapeHtml(note || "Nothing noted")}</td>
              <td><button type="button" data-open-saved="${i + 1}" aria-label="Open saved ${i + 1}">Open</button> <button type="button" data-remove-saved="${i + 1}" aria-label="Remove saved ${i + 1}">Remove</button></td></tr>`;
          })
          .join("")}</tbody></table>`
    : `<p class="muted">Nothing saved yet.</p>`;

  const state = presenceOf(session);
  $("presence").dataset.state = state;
  $("presence").textContent = PRESENCE[state];

  paused = Boolean(session.paused);
  pauseBtn.textContent = paused ? "Resume Tellr" : "Pause Tellr";
  pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");

  const listening = voice.status === "listening";
  listenBtn.textContent = listening ? "Stop listening" : "Start listening";
  listenBtn.setAttribute("aria-pressed", listening ? "true" : "false");

  if (!session.preferences) {
    prefsEl.innerHTML = `<p class="muted">Not set yet. Say or type what you want, like: a black jacket under $80.</p>`;
  } else {
    const items = session.preferences.requirements.map((req) => `<li>${escapeHtml(describeRequirement(req))}</li>`).join("");
    const questions = (session.clarificationQuestions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
    prefsEl.innerHTML = `
      <p><strong>${escapeHtml(session.preferences.category || "Item")}</strong> · ${escapeHtml(budgetText(session.preferences))}</p>
      <ul>${items || "<li>No extra requirements.</li>"}</ul>
      ${questions ? `<p class="muted">Still unclear</p><ul>${questions}</ul>` : ""}
    `;
  }

  const results = session.results || [];
  if (results.length) {
    const rows = results
      .map(
        (item, i) =>
          `<li>${escapeHtml(item.title)} — ${escapeHtml(formatUsd(item.priceCents))} ` +
          `<button type="button" data-number="${i + 1}" aria-label="Open number ${i + 1}: ${escapeHtml(item.title)}">Open</button></li>`,
      )
      .join("");
    resultsEl.innerHTML = `<p>Items on the page (${results.length})</p><ol>${rows}</ol>`;
  } else {
    resultsEl.innerHTML = "";
  }
  moreBtn.hidden = !(results.length > (session.resultsOffset || 0));

  // the listing's facts, one heading per topic, so a screen reader can jump between them
  const groups = Object.entries(FACT_TOPICS).filter(([key]) => session.facts?.[key]?.length);
  $("facts").hidden = !groups.length;
  $("facts-groups").innerHTML = groups
    .map(
      ([key, title]) =>
        `<h4>${escapeHtml(title)}</h4><ul>${session.facts[key]
          .map((f) => `<li>${escapeHtml(f.label)}: ${escapeHtml(f.value)}</li>`)
          .join("")}</ul>`,
    )
    .join("");

  if (!session.listing) {
    listingEl.innerHTML = `<p class="muted">Open a product page, then check it.</p>`;
  } else {
    const assessments = (session.report?.assessments || [])
      .map((row) => {
        const status = EVIDENCE_STATUS[row.status] || EVIDENCE_STATUS.unknown;
        return `<li><span class="tone-${status.tone}">${status.icon} ${status.label}</span> — ${escapeHtml(row.explanation)}</li>`;
      })
      .join("");
    const questions = (session.report?.sellerQuestions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
    listingEl.innerHTML = `
      <p><strong>${escapeHtml(session.listing.title)}</strong></p>
      <p>${escapeHtml(formatUsd(session.listing.itemPriceCents))} · ${session.listing.images.length} photo${session.listing.images.length === 1 ? "" : "s"}</p>
      ${assessments ? `<ul>${assessments}</ul>` : "<p class='muted'>Not checked yet.</p>"}
      ${questions ? `<p>Ask the seller</p><ul>${questions}</ul>` : ""}
    `;
  }

  if (!session.checkout) {
    checkoutEl.innerHTML = `<p class="muted">Check the item first, then review the cart or checkout page.</p>`;
  } else {
    const c = session.checkout;
    const review = session.review;
    const overall = review ? OVERALL[review.overall] : null;
    const checks = (review?.checks || [])
      .map((row) => {
        const status = CHECK_STATUS[row.status] || CHECK_STATUS.unknown;
        return `<li><span class="tone-${status.tone}">${status.icon} ${ruleLabel(row.ruleId)}</span> — ${escapeHtml(row.explanation)}</li>`;
      })
      .join("");
    checkoutEl.innerHTML = `
      <p>Qty ${c.quantity} · item ${escapeHtml(formatUsd(c.unitPriceCents))}</p>
      <p>Shipping ${c.shippingCents == null ? "unknown" : formatUsd(c.shippingCents)} · tax ${c.taxCents == null ? "unknown" : formatUsd(c.taxCents)}</p>
      ${c.addOns.length ? `<p>Add-ons: ${c.addOns.map((a) => escapeHtml(a.label)).join(", ")}</p>` : ""}
      ${overall ? `<p class="tone-${overall.tone}">${overall.icon} ${overall.label}</p>` : ""}
      ${review?.totalCents != null ? `<p>Computed total ${escapeHtml(formatUsd(review.totalCents))}</p>` : ""}
      ${checks ? `<ul>${checks}</ul>` : ""}
    `;
  }

  // two steps: the first press reads the order back, the second press confirms it
  const pending = !!session.pendingConfirm;
  cancelBtn.hidden = !pending;
  if (session.demoOrderId) {
    confirmCopy.textContent = `Demo order ${session.demoOrderId}. No real purchase.`;
    confirmBtn.textContent = "Confirm demo order";
    confirmBtn.disabled = true;
  } else if (pending) {
    confirmCopy.textContent = "I read the order back. Confirm only if it's right. Demo only, no payment.";
    confirmBtn.textContent = "Yes, confirm demo order";
    confirmBtn.disabled = false;
  } else {
    confirmCopy.textContent = "Confirmation is a demo only. No payment. No retailer purchase.";
    confirmBtn.textContent = "Confirm demo order";
    confirmBtn.disabled = session.review?.overall !== "pass";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
