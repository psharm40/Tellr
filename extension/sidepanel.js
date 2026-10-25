import { CHECK_STATUS, EVIDENCE_STATUS, OVERALL, budgetText, describeRequirement, formatUsd, ruleLabel } from "./lib/format.js";
import { formatHoldKey, getSettings } from "./lib/settings.js";

const $ = (id) => document.getElementById(id);
const live = $("live");
const prefsEl = $("prefs");
const listingEl = $("listing");
const checkoutEl = $("checkout");
const confirmCopy = $("confirm-copy");
const confirmBtn = $("confirm");

$("ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("ask").value.trim();
  if (!text) return;
  chrome.runtime.sendMessage({ type: "typed", text }).catch(() => {});
  $("ask").value = "";
});

$("inspect").addEventListener("click", () => chrome.runtime.sendMessage({ type: "inspect-now" }));
$("review").addEventListener("click", () => chrome.runtime.sendMessage({ type: "review-now" }));
$("confirm").addEventListener("click", () => chrome.runtime.sendMessage({ type: "confirm-now" }));
$("listen").addEventListener("click", () => {
  live.textContent = "Hold the shortcut on the shopping page. Chrome only hears the key there.";
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "session") render(message.session);
});

chrome.runtime.sendMessage({ type: "get-session" }, (response) => {
  if (response?.session) render(response.session);
});

const mac = navigator.platform.toUpperCase().includes("MAC");
getSettings().then((settings) => {
  $("shortcut").textContent = `Hold ${formatHoldKey(settings.holdKey, mac)} on the page. Change it in Settings.`;
});

function render(session) {
  const voice = session.voice || {};
  live.textContent = session.notice || session.lastAnswer || voice.transcript || "";

  if (!session.preferences) {
    prefsEl.innerHTML = `<p class="muted">Not set yet.</p>`;
  } else {
    const items = session.preferences.requirements.map((req) => `<li>${escapeHtml(describeRequirement(req))}</li>`).join("");
    const questions = (session.clarificationQuestions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
    prefsEl.innerHTML = `
      <p><strong>${escapeHtml(session.preferences.category || "Item")}</strong> · ${escapeHtml(budgetText(session.preferences))}</p>
      <ul>${items || "<li>No extra requirements.</li>"}</ul>
      ${questions ? `<p class="muted">Still unclear</p><ul>${questions}</ul>` : ""}
    `;
  }

  if (!session.listing) {
    listingEl.innerHTML = `<p class="muted">Open a product page, then inspect it.</p>`;
  } else {
    const assessments = (session.report?.assessments || [])
      .map((row) => {
        const status = EVIDENCE_STATUS[row.status] || EVIDENCE_STATUS.unknown;
        return `<li><span class="tone-${status.tone}">${status.icon} ${status.label}</span> — ${escapeHtml(row.explanation)}</li>`;
      })
      .join("");
    listingEl.innerHTML = `
      <p><strong>${escapeHtml(session.listing.title)}</strong></p>
      <p>${escapeHtml(formatUsd(session.listing.itemPriceCents))} · ${session.listing.images.length} photo${session.listing.images.length === 1 ? "" : "s"}</p>
      ${assessments ? `<ul>${assessments}</ul>` : "<p class='muted'>Not inspected yet.</p>"}
    `;
  }

  if (!session.checkout) {
    checkoutEl.innerHTML = `<p class="muted">Inspect first, then review the cart or checkout page.</p>`;
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

  if (session.demoOrderId) {
    confirmCopy.textContent = `Demo order ${session.demoOrderId}. No real purchase.`;
    confirmBtn.disabled = true;
  } else {
    confirmCopy.textContent = "Confirmation is a demo only. No payment. No retailer purchase.";
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
