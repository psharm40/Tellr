// turn a content-script page snapshot into the shared listing + checkout types.
import { titlesMatch } from "./session.js";

function shortId(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function listingIdFor(page) {
  return `listing_${shortId(`${page.url}|${page.title}`)}`;
}

export function buildListing(page, images) {
  const products = Array.isArray(page.products) ? page.products : [];
  const priced = products.filter((item) => Number.isInteger(item.priceCents) && item.priceCents > 0);
  const focus = priced.length ? priced.reduce((a, b) => (a.priceCents <= b.priceCents ? a : b)) : null;
  return {
    id: listingIdFor(page),
    title: focus?.title || page.title || "Untitled listing",
    description: page.description || "",
    category: page.category || "item",
    itemPriceCents: Number.isInteger(page.itemPriceCents) && page.itemPriceCents > 0 ? page.itemPriceCents : focus?.priceCents ?? 0,
    currency: "USD",
    images,
  };
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function namedProducts(products, pageTitle) {
  return products.filter((item) => {
    const title = String(item.title || "").trim();
    if (title.length < 4) return false;
    if (/^priced item/i.test(title)) return false;
    if (/\b(gifts under|shop by|shop now|free shipping|% off)\b/i.test(title)) return false;
    if (pageTitle && title === pageTitle) return false;
    return true;
  });
}

export function answerFromPage(question, page) {
  let products = (page.products || []).filter((item) => Number.isInteger(item.priceCents) && item.priceCents > 0);
  if (!products.length && Number.isInteger(page.itemPriceCents) && page.itemPriceCents > 0) {
    products = [{ title: page.title || "This listing", priceCents: page.itemPriceCents }];
  }
  if (!products.length) {
    return "I can open this page, but I could not read any prices on it. Open a product or search results page that shows dollar amounts, then ask again.";
  }
  if (/\b(how much|what('s| is) (the )?(price|cost)|this (item|one|shoe|listing|product))\b/i.test(question) && page.itemPriceCents > 0) {
    return `${page.title || "This listing"} is listed at ${money(page.itemPriceCents)} on this page.`;
  }
  const mentioned = String(question)
    .toLowerCase()
    .match(/\b(cheapest|lowest|most expensive|highest)\s+([a-z0-9-]{3,20})/i);
  const kind = mentioned?.[2] && !/price|priced|item|one|on/.test(mentioned[2]) ? mentioned[2] : "";
  const named = namedProducts(products, page.title);
  const base = named.length ? named : products;
  const pool = kind ? base.filter((item) => item.title.toLowerCase().includes(kind)) : base;
  const used = pool.length ? pool : base;
  const wantHigh = /\b(most expensive|highest)\b/i.test(question);
  const sorted = [...used].sort((a, b) => a.priceCents - b.priceCents);
  const pick = wantHigh ? sorted[sorted.length - 1] : sorted[0];
  const next = (wantHigh ? [...sorted].reverse() : sorted).slice(1, 3);
  const label = wantHigh ? "highest" : "lowest";
  let spoken = `${pick.title} is the ${label} price I can read, ${money(pick.priceCents)}.`;
  if (next.length) {
    spoken += ` Next: ${next.map((item) => `${item.title} at ${money(item.priceCents)}`).join("; ")}.`;
  }
  const kidTitle = /\b(little kid|big kid|toddler|infant|pre[- ]?school|baby)\b/i;
  if (!wantHigh && !/\b(kid|child|toddler|baby)\b/i.test(question)) {
    const adult = sorted.filter((item) => !kidTitle.test(item.title));
    if (adult.length && kidTitle.test(pick.title)) {
      spoken += ` The lowest adult size I can read is ${adult[0].title} at ${money(adult[0].priceCents)}.`;
    }
  }
  spoken += ` I compared ${sorted.length} priced items visible on this page.`;
  return spoken;
}

export function buildCheckout(page, selectedListingId, inspectedTitle) {
  const hints = page.checkoutHints || {};
  const matches = selectedListingId && titlesMatch(hints.cartTitle || page.title, inspectedTitle || page.title);
  return {
    id: `checkout_${shortId(page.url)}`,
    version: 1,
    listingId: matches ? selectedListingId : listingIdFor(page),
    currency: "USD",
    quantity: Number.isInteger(hints.quantity) && hints.quantity > 0 ? hints.quantity : 1,
    unitPriceCents: Number.isInteger(hints.unitPriceCents) ? hints.unitPriceCents : 0,
    shippingCents: hints.shippingCents ?? null,
    taxCents: hints.taxCents ?? null,
    addOns: Array.isArray(hints.addOns) ? hints.addOns : [],
    hasSubscription: typeof hints.hasSubscription === "boolean" ? hints.hasSubscription : null,
    estimatedDeliveryDate: hints.estimatedDeliveryDate ?? null,
  };
}
