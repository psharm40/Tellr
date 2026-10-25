// in-memory shopping session. checkout math still happens on the server.

export function createSession() {
  return {
    pageUrl: null,
    listing: null,
    checkout: null,
    preferences: null,
    clarificationQuestions: [],
    // everything said about the current goal (first request, then each answer), so a follow-up
    // question never forgets an earlier answer like the budget or size
    requirementsTurns: [],
    requirementsText: "",
    report: null,
    review: null,
    demoOrderId: null,
    // a "confirm" that read back the order and is waiting for "yes, confirm"
    pendingConfirm: null,
    // "pause": tellr stays quiet but remembers everything until the shopper talks again
    paused: false,
    // "turn off": mic and panel closed, silent until the shortcut or hold key turns it back on
    off: false,
    // the welcome ("you're on the ebay home page... what are you shopping for?") was given
    oriented: false,
    // what tellr is busy doing, for "are you there?" ("searching for that")
    activity: "",
    // something finished while paused, so "resume" offers to say it
    missedWhilePaused: false,
    // "i'm done shopping" asked "clear everything?" and is waiting for yes or no
    pendingEnd: false,
    // the open listing's facts by topic (seller, popularity, returns...), from the page
    facts: null,
    // numbered search results read aloud, for "open number 2"
    results: [],
    resultsOffset: 0,
    // inspections from "compare the top 3", reused when one of them is opened
    comparisons: [],
    // the items tellr last named for "the ones with...", so "compare them" means those
    focusNumbers: [],
    // the one question tellr thinks would best help choose between the current options
    followUp: "",
    history: [],
    lastAnswer: "",
    // what was last said aloud, for "say that again"
    lastSpoken: "",
    notice: null,
    busy: false,
    voice: { status: "idle", transcript: "" },
  };
}

export function pushHistory(session, role, text) {
  const clipped = String(text).trim().slice(0, 1000);
  if (!clipped) return session;
  return { ...session, history: [...session.history, { role, text: clipped }].slice(-6) };
}

export function bumpCheckout(session, checkout) {
  const prev = session.checkout;
  if (!checkout) return { ...session, checkout: null, review: null, demoOrderId: null, pendingConfirm: null };
  const same =
    prev &&
    prev.listingId === checkout.listingId &&
    prev.quantity === checkout.quantity &&
    prev.unitPriceCents === checkout.unitPriceCents &&
    prev.shippingCents === checkout.shippingCents &&
    prev.taxCents === checkout.taxCents &&
    prev.hasSubscription === checkout.hasSubscription &&
    prev.estimatedDeliveryDate === checkout.estimatedDeliveryDate &&
    JSON.stringify(prev.addOns) === JSON.stringify(checkout.addOns);
  if (same) return { ...session, checkout: prev };
  return {
    ...session,
    checkout: { ...checkout, version: prev ? prev.version + 1 : 1 },
    review: null,
    demoOrderId: null,
    // a changed checkout cancels a confirmation that was waiting for "yes"
    pendingConfirm: null,
  };
}

// kinds of item. naming a different kind ("a black tank top" while shopping for shoes) starts a
// new goal, so the old one isn't carried into the search. bare "top" and "watch" are left out:
// "the top 3" and "how many people watch it" aren't new items.
const TOPIC = [
  ["shoe", /\b(shoes?|sneakers?|trainers?|boots?|booties|sandals?|heels|pumps|loafers?|flats|mules|clogs?|oxfords|slippers|footwear)\b/i],
  ["top", /\b((?:tank|crop|tube|halter|knit)\s+tops?|tops|tanks?|camis?|camisoles?|t-?shirts?|tees?|shirts?|blouses?|sweaters?|cardigans?|hoodies?|sweatshirts?|polos?|jerseys?)\b/i],
  ["bottom", /\b(pants|jeans|trousers|shorts|skirts?|leggings|joggers|sweatpants)\b/i],
  ["dress", /\b(dress|dresses|gowns?|jumpsuits?|rompers?)\b/i],
  ["outerwear", /\b(jackets?|coats?|blazers?|parkas?|puffers?|raincoats?|vests?)\b/i],
  ["bag", /\b(bags?|purses?|handbags?|backpacks?|totes?|wallets?|clutch(?:es)?)\b/i],
  ["jewelry", /\b(necklaces?|earrings?|bracelets?|jewelry|jewellery)\b/i],
  ["watch", /\b(watches|wristwatch(?:es)?|smartwatch(?:es)?)\b/i],
  ["hat", /\b(hats?|caps?|beanies?)\b/i],
  ["laptop", /\b(laptop|laptops|notebook|macbook|chromebook|computer)\b/i],
  ["phone", /\b(phone|iphone|android|pixel|smartphone)\b/i],
  ["headphone", /\b(headphone|headphones|earbuds|airpods)\b/i],
  ["tv", /\b(television|\btv\b|monitor)\b/i],
];

// the kind named first wins: "a tank top to wear with my boots" is a top
export function topicFromText(text) {
  const blob = String(text || "");
  let best = null;
  for (const [topic, pattern] of TOPIC) {
    const at = blob.search(pattern);
    if (at >= 0 && (!best || at < best.at)) best = { topic, at };
  }
  return best?.topic ?? null;
}

// what most of a page's items are, so one "you may also like" shoe on a tank top page doesn't count
function mainTopic(titles) {
  const counts = new Map();
  for (const title of titles) {
    const topic = topicFromText(title);
    if (topic) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] >= Math.max(2, titles.length / 3) ? top[0] : null;
}

// marketplaces rewrite item urls (tracking codes, the title in the path), so the same listing
// is matched by its item id; other pages by path
const ITEM_ID = /\/(?:itm|dp|gp\/product)\/(?:[^/?#]*\/)?([A-Za-z0-9]{6,})/;

export function samePage(a, b) {
  const idA = String(a).match(ITEM_ID)?.[1];
  const idB = String(b).match(ITEM_ID)?.[1];
  if (idA || idB) return idA === idB;
  try {
    return new URL(a).pathname === new URL(b).pathname;
  } catch {
    return a === b;
  }
}

export function forgetStaleGoal(session, page, spoken) {
  const spokenTopic = topicFromText(spoken);
  const prefTopic = topicFromText(session.preferences?.category || "");
  const listingTopic = topicFromText(`${session.listing?.title || ""} ${session.listing?.category || ""}`);
  const pageTopic =
    page?.pageKind === "listing"
      ? topicFromText(`${page?.title || ""} ${page?.category || ""}`)
      : mainTopic((page?.products || []).map((item) => item.title));
  const pageChanged = session.pageUrl && page?.url && !samePage(session.pageUrl, page.url);
  const conflict =
    (spokenTopic && prefTopic && spokenTopic !== prefTopic) ||
    (pageTopic && prefTopic && pageTopic !== prefTopic) ||
    (spokenTopic && listingTopic && spokenTopic !== listingTopic);
  if (!conflict && !pageChanged) return { ...session, pageUrl: page?.url || session.pageUrl };
  return {
    ...session,
    pageUrl: page?.url || session.pageUrl,
    listing: pageChanged || conflict ? null : session.listing,
    preferences: conflict ? null : session.preferences,
    clarificationQuestions: conflict ? [] : session.clarificationQuestions,
    report: pageChanged || conflict ? null : session.report,
    review: null,
    demoOrderId: null,
    pendingConfirm: null,
    checkout: pageChanged || conflict ? null : session.checkout,
    // keep results across a page change so "open number 3" still works after opening number 2
    results: conflict ? [] : session.results,
    comparisons: conflict ? [] : session.comparisons,
    history: conflict ? [] : session.history,
  };
}

export function titlesMatch(a, b) {
  const clean = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}
