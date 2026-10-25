// in-memory shopping session. checkout math still happens on the server.
import { requestsItem } from "./intent.js";
import { withoutNegated } from "./screen.js";

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
    // "pause or close?" is waiting for one of the two words
    pendingLeave: false,
    // items the shopper saved to come back to, across searches (cleared only by closing tellr):
    // [{ key, url, title, description, priceCents, fit, flaw, unknown }]
    shortlist: [],
    // the rest of a seller's description being read in parts, for "read more"
    descriptionLeft: "",
    // "I'll use your usual shoe size, 8": said once, the first time it's used for a goal
    sizeNote: "",
    sizeNoted: "",
    // "before you go, want me to save this one?": the item, and what to do after the answer
    pendingSaveOffer: null,
    // items already offered, so the offer is made once per item
    saveOffered: [],
    // "clear all your saved items?" is waiting for yes or no
    pendingClearSaved: false,
    // the open listing's facts by topic (seller, popularity, returns...), from the page
    facts: null,
    // numbered search results read aloud, for "open number 2"
    results: [],
    resultsOffset: 0,
    // inspections from "compare the top 3", reused when one of them is opened
    comparisons: [],
    // the items tellr last named for "the ones with...", so "compare them" means those
    focusNumbers: [],
    // items whose full description was already read aloud (by item id); later mentions get a
    // few-word reminder instead of the whole description again
    heard: [],
    // the one item the shopper is on (its item id), and what was said about it. while it's set,
    // answers stay on this item; the list comes back only on "go back" or a new search.
    focusKey: "",
    // tellr's questions about the goal and the shopper's answers ([{ topic, question, answer }]);
    // a topic is asked once per goal. awaiting: the question tellr just asked, if any
    asked: [],
    awaiting: null,
    // the basics are known (or the shopper said "just search") and the first search has run
    interviewDone: false,
    // "this one doesn't fit. want me to search for ones that do?" is waiting for yes or no
    pendingSearch: false,
    itemTalk: [],
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

// the kind of item a phrase is about. in a noun phrase the last item word is the item itself:
// "cap toe oxfords" are shoes, "boot cut jeans" are jeans. across phrases the first one wins:
// "a tank top to wear with my boots" is a top.
const PHRASE_BREAK = /[,.;:!?]|\b(?:to|with|for|and|or|but|from|of|in|on|at|that|which|who|wear|wearing|match(?:es|ing)?|go(?:es)?|comes?|came|has|have|had|includ(?:e|es|ing)|plus|like|under|over|without|by)\b/i;
export function topicFromText(text) {
  for (const phrase of String(text || "").split(PHRASE_BREAK)) {
    if (!phrase) continue;
    let head = null;
    for (const [topic, pattern] of TOPIC) {
      for (const match of phrase.matchAll(new RegExp(pattern.source, "gi"))) {
        if (!head || match.index > head.at) head = { topic, at: match.index };
      }
    }
    if (head) return head.topic;
  }
  return null;
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

// one key per listing, whatever tracking codes or title text the url carries
export function itemKey(url) {
  return String(url || "").match(ITEM_ID)?.[1] || String(url || "").split(/[?#]/)[0];
}

// an item's own page on a marketplace (ebay /itm/, amazon /dp/), told from the address alone
export function isItemUrl(url) {
  return ITEM_ID.test(String(url || ""));
}

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
  // only a request names a new item: not a question about this one, and not what they rule out
  const spokenTopic = requestsItem(spoken) ? topicFromText(withoutNegated(spoken)) : null;
  const prefTopic = topicFromText(session.preferences?.category || "");
  const listingTopic = topicFromText(`${session.listing?.title || ""} ${session.listing?.category || ""}`);
  const pageTopic =
    page?.pageKind === "listing"
      ? topicFromText(`${page?.title || ""} ${page?.category || ""}`)
      : mainTopic((page?.products || []).map((item) => item.title));
  const pageChanged = session.pageUrl && page?.url && !samePage(session.pageUrl, page.url);
  // a page of other things only means a new goal once this goal was searched and the shopper
  // went to a different results or item page themselves. the home page's deals, or the page
  // they started the questions on, never wipe the answers they're in the middle of giving.
  // the whole address: a new search on the same site (/s?k=headphones) is a different page
  const moved = Boolean(session.pageUrl && page?.url && page.url.split("#")[0] !== String(session.pageUrl).split("#")[0]);
  const pageSwitch =
    Boolean(session.interviewDone && moved && (page?.place === "results" || page?.place === "listing")) &&
    Boolean(pageTopic && prefTopic && pageTopic !== prefTopic);
  const conflict =
    (spokenTopic && prefTopic && spokenTopic !== prefTopic) ||
    pageSwitch ||
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
    // a new goal gets its own questions
    asked: conflict ? [] : session.asked,
    awaiting: conflict ? null : session.awaiting,
    interviewDone: conflict ? false : session.interviewDone,
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
