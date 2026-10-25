// display wording for the shared tellr types. no checkout math lives here.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents) {
  return usd.format(cents / 100);
}

// typed dollars like "15", "15.5" or "$1,299.00" to integer cents without floating point
export function parseDollarsToCents(text) {
  const match = String(text).trim().replace(/,/g, "").match(/^\$?\s*(\d{1,7})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const EVIDENCE_STATUS = {
  supported: { icon: "✓", label: "Supported by evidence", tone: "good" },
  seller_claimed: { icon: "?", label: "Seller claims it, not verified", tone: "warn" },
  contradicted: { icon: "✕", label: "Contradicted by evidence", tone: "bad" },
  unknown: { icon: "?", label: "Unknown: not enough evidence", tone: "warn" },
};

export const CHECK_STATUS = {
  pass: { icon: "✓", label: "Pass", tone: "good" },
  fail: { icon: "✕", label: "Problem", tone: "bad" },
  unknown: { icon: "?", label: "Unknown", tone: "warn" },
};

export const OVERALL = {
  pass: { icon: "✓", label: "Passed review. You can place a demo order.", tone: "good" },
  blocked: { icon: "✕", label: "Blocked. Fix the problems below first.", tone: "bad" },
  needs_review: { icon: "?", label: "Needs review. Some important details are unknown.", tone: "warn" },
};

const RULE_LABEL = {
  total_budget: "Total within budget",
  item_match: "Same item you inspected",
  quantity: "Quantity",
  unexpected_addons: "Add-ons you did not ask for",
  subscription: "Subscription",
  delivery: "Delivery date",
  price_breakdown: "Price breakdown",
  seller_condition: "Item condition",
};

const ATTRIBUTE_LABEL = {
  screen_condition: "Screen condition",
  charger_included: "Charger included",
  cosmetic_scratches: "Wear level",
  delivery_by_date: "Delivered by",
  quantity: "Quantity",
  color: "Color",
  no_unrequested_addons: "No add-ons I did not ask for",
  no_subscription: "No subscription",
};

function humanize(value) {
  const text = String(value).replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ruleLabel(ruleId) {
  return RULE_LABEL[ruleId] ?? humanize(ruleId);
}

function valueText(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return String(value).replace(/_/g, " ");
}

export function describeRequirement(requirement) {
  const label = ATTRIBUTE_LABEL[requirement.attribute] ?? humanize(requirement.attribute);
  if (requirement.attribute === "cosmetic_scratches" && typeof requirement.value === "boolean") {
    return `${label}: ${requirement.value ? "some visible wear is okay" : "like new only"}`;
  }
  switch (requirement.operator) {
    case "allowed":
      return `${label}: ${requirement.value === false ? "not okay" : "okay"}`;
    case "at_most":
      return `${label}: at most ${valueText(requirement.value)}`;
    case "at_least":
      return `${label}: at least ${valueText(requirement.value)}`;
    default:
      return `${label}: ${valueText(requirement.value)}`;
  }
}

export function budgetText(preferences) {
  return preferences.maxTotalCents === null ? "No budget given" : `Up to ${formatUsd(preferences.maxTotalCents)} total`;
}

export function preferencesSpeech(preferences, questions) {
  const parts = [`Got it. Looking for ${preferences.category || "something"}, ${budgetText(preferences).toLowerCase()}.`];
  for (const requirement of preferences.requirements) {
    parts.push(`${describeRequirement(requirement)}${requirement.priority === "required" ? ", required" : ""}.`);
  }
  if (questions.length) parts.push(questions.join(" "));
  return parts.join(" ");
}

// "$28.00" is read aloud as "28 zero zero", so prices are spelled the way people say them:
// "28 dollars", "28 dollars and 50 cents". the screen keeps the $ form.
export function speakablePrices(text) {
  return String(text).replace(/(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?\b/g, (_, whole, cents) => {
    const dollars = `${whole} ${whole === "1" ? "dollar" : "dollars"}`;
    if (!cents || cents === "00") return dollars;
    return whole === "0" ? `${Number(cents)} cents` : `${dollars} and ${Number(cents)} ${cents === "01" ? "cent" : "cents"}`;
  });
}

export function clipForSpeech(text, max = 1400) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest is in the side panel.`;
}

// what tellr is doing right now, named the same way as its sounds: listening (rising tone),
// thinking (soft pulse), speaking, your turn (bright chime), paused, off
export const PRESENCE = {
  off: "Off",
  paused: "Paused",
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Thinking",
  ready: "Your turn",
};

export function presenceOf(session) {
  if (session?.off) return "off";
  if (session?.paused) return "paused";
  const status = session?.voice?.status;
  if (status === "listening") return "listening";
  if (status === "speaking") return "speaking";
  if (session?.busy || status === "processing") return "thinking";
  return "ready";
}

// one short suggestion for what to say next, so nobody has to memorize commands
export function nextHint(session) {
  if (session.pendingLeave) return "Say pause or close.";
  if (session.paused) return "Say resume when you're ready.";
  if (session.pendingConfirm) return "Say yes, confirm to place the demo order, or say cancel.";
  if (!session.preferences) return "Tell me what you want to buy, or say help.";
  // on one item, hints stay on that item; the list comes back only when asked for
  if (session.focusKey && !session.report) return "Ask me how it looks, or say check this item. Say go back for the other options.";
  if (session.focusKey && !session.review) return "Ask me anything about it, or say take me to checkout. Say go back for the other options.";
  if (!session.report) {
    return session.results?.length
      ? "Say open number 1, or another number, to pick an item."
      : "On a listing, say check this item. On a search page, say list them.";
  }
  if (!session.review) return "Ask me anything about it, or go to checkout and say review checkout.";
  if (session.demoOrderId) return "Say start over to shop for something else, or close to finish.";
  if (session.review.overall === "pass") return "Say confirm when you're ready for the demo order.";
  return "Fix that on the page, then say review checkout again.";
}

// step-aware answer to "help" or "what can I say"
// answers "why is the tax that much?" from the numbers read off the page. tellr never works
// out tax or shipping itself: it says where a number came from and flags one that looks off
export function checkoutAnswer(question, checkout, review) {
  const asked = String(question || "").toLowerCase();
  const itemCents = checkout.unitPriceCents * checkout.quantity;
  const parts = [];
  if (/\btax/.test(asked)) {
    if (checkout.taxCents == null) {
      parts.push("I didn't find a tax amount on this page, so I left it out. Tax usually shows on the final checkout page, after your address is in.");
    } else {
      const percent = itemCents > 0 ? Math.round((checkout.taxCents / itemCents) * 100) : null;
      parts.push(`I don't work out tax myself. I read ${formatUsd(checkout.taxCents)} from the line labeled tax on this page.`);
      if (percent != null && percent > 15) {
        parts.push(
          `That's about ${percent} percent of the ${formatUsd(itemCents)} item, much higher than normal US sales tax, which is usually under 10 percent. I may have read the wrong line, or that charge includes other fees. Check the tax line with your screen reader before you pay.`,
        );
      } else if (percent != null) {
        parts.push(`That's about ${percent} percent of the ${formatUsd(itemCents)} item, a normal amount for sales tax. It depends on where the order ships.`);
      }
    }
  }
  if (/\b(shipping|delivery)\b/.test(asked)) {
    if (checkout.shippingCents == null) parts.push("I didn't find a shipping cost on this page, so the total isn't final yet.");
    else if (checkout.shippingCents === 0) parts.push("The page says shipping is free.");
    else parts.push(`I read ${formatUsd(checkout.shippingCents)} from the shipping line. The seller sets their own shipping cost.`);
  }
  if (!parts.length) {
    const addOnCents = checkout.addOns.reduce((sum, a) => sum + a.priceCents, 0);
    const pieces = [
      `the item is ${formatUsd(itemCents)}`,
      checkout.shippingCents == null ? "shipping isn't shown" : `shipping is ${formatUsd(checkout.shippingCents)}`,
      checkout.taxCents == null ? "tax isn't shown" : `tax is ${formatUsd(checkout.taxCents)}`,
      addOnCents ? `add-ons are ${formatUsd(addOnCents)}` : "",
    ].filter(Boolean);
    const total = review?.totalCents != null ? ` That comes to ${formatUsd(review.totalCents)}.` : " So I can't give a final total yet.";
    parts.push(`From this page: ${pieces.join(", ")}.${total}`);
  }
  parts.push("Say review checkout to read the page again.");
  return parts.join(" ");
}

// --- facts from the listing page, read as written and grouped by topic
export const FACT_TOPICS = {
  seller: "About the seller",
  popularity: "How popular it is",
  condition: "Condition",
  returns: "Returns",
  shipping: "Shipping",
  payment: "Payment",
  specifics: "Item details",
  reviews: "Reviews",
};

const factValue = (group, label) => group.find((f) => f.label === label)?.value;
// "12K" reads as "12 thousand"; a label ending in a preposition needs no colon
const spokenValue = (value) => String(value).replace(/(\d)\s*K\b/g, "$1 thousand").replace(/(\d)\s*M\b/g, "$1 million").replace(/[.\s]+$/, "");
const factRows = (rows) => rows.map((f) => `${f.label}${/\b(within|in|from|since)$/i.test(f.label) ? "" : ":"} ${spokenValue(f.value)}.`).join(" ");
// "1.2K" -> 1200, "2,345" -> 2345
function parseCount(value) {
  const m = String(value || "").replace(/,/g, "").match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1000 : 1_000_000) : 1));
}

// facts plus a plain, fair read of the track record. a rating says how past buyers felt;
// it is never a promise about this item.
function sellerSpeech(seller) {
  if (!seller.length) {
    return "I couldn't find the seller's ratings on this page. On eBay they're next to the seller's name, so try scrolling there and asking again.";
  }
  const name = factValue(seller, "Seller");
  const percent = parseFloat(factValue(seller, "Positive feedback"));
  const ratings = parseCount(factValue(seller, "Ratings"));
  const sold = factValue(seller, "Items sold");
  const parts = [];
  parts.push(
    [
      name ? `The seller is ${name}.` : "",
      Number.isFinite(percent) ? `${percent} percent positive feedback${ratings ? ` from ${ratings.toLocaleString("en-US")} ratings` : ""}.` : "",
      sold ? `They've sold ${spokenValue(sold)} items.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const rest = seller.filter((f) => !["Seller", "Positive feedback", "Ratings", "Items sold"].includes(f.label));
  if (rest.length) parts.push(factRows(rest));
  if (Number.isFinite(percent)) {
    if (percent < 95) parts.push("That's lower than most eBay sellers, who are usually above 98 percent. Reading their recent negative feedback first would help.");
    else if (ratings != null && ratings < 20) parts.push("That's only a few ratings, so there isn't much history to go on yet.");
    else if (percent >= 98) parts.push("That's a strong track record, though it can't promise anything about this particular item.");
    else parts.push("That's a fair track record. Most good eBay sellers are above 98 percent.");
  }
  return parts.join(" ");
}

function popularitySpeech(popularity) {
  if (!popularity.length) return "This page doesn't show how many have sold or how many people are watching it.";
  const sold = factValue(popularity, "Sold");
  const watching = factValue(popularity, "Watching");
  const carts = factValue(popularity, "In carts");
  const available = factValue(popularity, "Available");
  const parts = [
    sold ? `${sold} sold` : "",
    watching ? `${watching} ${watching === "1" ? "person is" : "people are"} watching it` : "",
    carts ? `${carts} ${carts === "1" ? "person has" : "people have"} it in their cart` : "",
    available ? `${available} available` : "",
  ].filter(Boolean);
  const rest = popularity.filter((f) => !["Sold", "Watching", "In carts", "Available"].includes(f.label));
  return [parts.length ? `${parts.join(", ")}.` : "", factRows(rest)].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase());
}

// item details related to what the shopper asked for (size, color, material...) come first
function relevantFirst(rows, preferences) {
  const wanted = (preferences?.requirements || []).map((r) => String(r.attribute).replace(/_/g, " ").toLowerCase());
  const score = (f) => (wanted.some((w) => f.label.toLowerCase().includes(w) || w.includes(f.label.toLowerCase())) ? 0 : 1);
  return [...rows].sort((a, b) => score(a) - score(b));
}

// topic: one FACT_TOPICS key, or null for a short tour of everything, most useful first
// what other buyers wrote, in their own words. seller-reviews puts feedback on the seller first.
function reviewsSpeech(reviews, aboutSeller) {
  const ordered = [...(reviews || [])].sort((a, b) => Number(b.label === "Seller feedback") - Number(a.label === "Seller feedback"));
  const pick = (aboutSeller ? ordered : [...ordered].reverse()).slice(0, 2);
  if (!pick.length) {
    return "I couldn't find any written reviews on this page. Some sites load them only as you scroll, so scrolling down to the reviews and asking again can help.";
  }
  const lines = pick.map((row, i) => {
    const who = row.label === "Seller feedback" ? "about the seller" : "about the item";
    return `${i === 0 ? "One buyer wrote" : "Another wrote"} ${who}: ${row.value.replace(/[.!?\s]*$/, ".")}`;
  });
  const more = reviews.length > pick.length ? ` There are ${reviews.length - pick.length} more in the side panel.` : "";
  return `${lines.join(" ")}${more}`;
}

// hints: the page's checkout numbers, used only when no shipping section was found
export function factsSpeech(facts, topic, preferences, hints = null) {
  if (!facts) return "Open the item's own page, and I can tell you about the seller, how popular it is, returns, and shipping.";
  if (topic === "seller") return sellerSpeech(facts.seller);
  if (topic === "popularity") return popularitySpeech(facts.popularity);
  if (topic === "reviews" || topic === "seller-reviews") return reviewsSpeech(facts.reviews, topic === "seller-reviews");
  if (topic) {
    const rows = topic === "specifics" ? relevantFirst(facts.specifics, preferences).slice(0, 8) : facts[topic] || [];
    if (rows.length) return factRows(rows);
    if (topic === "shipping" && hints?.shippingCents != null) {
      return hints.shippingCents === 0 ? "The page says shipping is free." : `Shipping is ${formatUsd(hints.shippingCents)}, from the page.`;
    }
    // unknown, never guessed
    return `I couldn't find anything about ${FACT_TOPICS[topic].toLowerCase()} on this page.`;
  }
  const parts = [];
  if (facts.seller.length) parts.push(`${FACT_TOPICS.seller}. ${sellerSpeech(facts.seller)}`);
  if (facts.popularity.length) parts.push(`${FACT_TOPICS.popularity}. ${popularitySpeech(facts.popularity)}`);
  for (const key of ["condition", "returns", "shipping"]) {
    if (facts[key].length) parts.push(`${FACT_TOPICS[key]}. ${factRows(facts[key].slice(0, 2))}`);
  }
  if (facts.specifics.length) parts.push(`${FACT_TOPICS.specifics}. ${factRows(relevantFirst(facts.specifics, preferences).slice(0, 4))}`);
  if (!parts.length) return "I couldn't find seller ratings or item details on this page.";
  parts.push("Everything is grouped in the side panel. Ask about any one, like: can I trust this seller?");
  return parts.join(" ");
}

// where the shopper is right now, in a sentence or two, e.g. for the welcome or "where am i"
export function placeSpeech(page) {
  if (!page) return "There's no shopping page in front right now.";
  let host = "this site";
  try {
    host = new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    // keep the generic name
  }
  const site = /ebay\./i.test(host) ? "eBay" : /amazon\./i.test(host) ? "Amazon" : host;
  // "Women's Brown Leather Penny Loafers Size 8" -> "Women's Brown Leather Penny Loafers"
  const short = (title) =>
    String(title || "")
      .replace(/\b(?:size|sz)\b\s*[\w.]*/gi, "")
      .replace(/\b\d+(?:\.\d+)?\b/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(" ");
  const names = (page.products || []).map((p) => short(p.title)).filter(Boolean).slice(0, 3);
  const examples = names.length ? ` It shows items like ${names.length > 1 ? `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}` : names[0]}.` : "";
  switch (page.place) {
    case "home":
      return `You're on the ${site} home page, with deals and items picked for you.${examples}`;
    case "results": {
      const count = page.products?.length ? ` I can see ${page.products.length} items.` : "";
      return `You're on ${site} search results${page.searchQuery ? ` for ${page.searchQuery}` : ""}.${count}`;
    }
    case "listing":
      return `You're on a ${site} listing: ${short(page.title)}${page.itemPriceCents ? `, ${formatUsd(page.itemPriceCents)}` : ""}.`;
    case "cart":
      return `You're in your ${site} cart. Say review checkout, and I'll check the total before you pay.`;
    case "checkout":
      return `You're on the ${site} checkout page. Say review checkout, and I'll check the total, fees, and add-ons before you pay.`;
    default:
      return `You're on ${site}.`;
  }
}

// the first thing tellr says when turned on: where you are, then one question.
// first ever use also gets the three things worth knowing.
export function welcomeSpeech(page, session, { firstTime = false } = {}) {
  const parts = [placeSpeech(page)];
  if (firstTime) {
    parts.push(
      "Here's how I sound. A rising tone means I'm listening. A soft pulse means I'm thinking. A bright chime means I'm done and it's your turn; after a question, I'll start listening right after it. Say are you there to check on me, pause to take a break, close when you're finished, or help any time.",
    );
  }
  // saved items from before: said once, short, so the shopper knows the list is there
  const saved = session.shortlist?.length || 0;
  if (saved) {
    parts.push(`You have ${saved} saved item${saved === 1 ? "" : "s"} from before. Say what's on my list to hear ${saved === 1 ? "it" : "them"}.`);
  }
  // the question comes last, right before the microphone opens
  parts.push(
    session.preferences?.category
      ? `Last time, we were looking for ${session.preferences.category}. What would you like to do next?`
      : "What are you shopping for today?",
  );
  return parts.join(" ");
}

// one saved item, in a few words: what it is, the price, how well it fits, the main flaw or unknown
export function savedLine(entry, number) {
  const fit = VERDICT_WORDS_SHORT[entry.fit] ? `, ${VERDICT_WORDS_SHORT[entry.fit]}` : "";
  const issue = entry.flaw ? ` ${entry.flaw}` : entry.unknown ? ` Still unknown: ${entry.unknown}` : "";
  return `Saved ${number}: ${reminderName(entry)}, ${formatUsd(entry.priceCents)}${fit}.${issue}`;
}

const VERDICT_WORDS_SHORT = { great_pick: "a great pick", good_pick: "a good pick", okay_pick: "an okay pick", risky: "risky", not_a_match: "not a match" };

export function shortlistSpeech(list) {
  if (!list?.length) return "Your list is empty. On an item, say save this one, or say save number 2 while I'm reading results.";
  const lines = list.map((entry, i) => savedLine(entry, i + 1));
  return `You've saved ${list.length}. ${lines.join(" ")} Say open saved 1, compare my saved ones, or remove saved 1.`;
}

// the seller's description, word for word, a part at a time; returns what's left for "read more"
const DESCRIPTION_PART = 700;
export function descriptionPart(text, first = true) {
  const words = String(text || "").replace(/\s+/g, " ").trim();
  if (!words) return { spoken: "I couldn't find the seller's own description on this page. The item details I could read are in the side panel.", left: "" };
  let cut = words.length;
  if (words.length > DESCRIPTION_PART) {
    const end = words.lastIndexOf(". ", DESCRIPTION_PART);
    cut = end > 200 ? end + 1 : DESCRIPTION_PART;
  }
  const part = words.slice(0, cut).trim();
  const left = words.slice(cut).trim();
  return {
    spoken: `${first ? "The seller wrote: " : ""}${part}${left ? " That's part of it. Say read more for the rest." : first ? " That's the whole description." : " That's the end of the description."}`,
    left,
  };
}

// "how much with shipping?": the item's price plus shipping, added up here, never guessed. tax
// isn't known until checkout, so it's named, not estimated.
export function itemTotalSpeech(priceCents, shippingCents) {
  if (!(priceCents > 0)) return "I couldn't read this item's price on the page, so I can't add it up.";
  if (shippingCents == null) {
    return `It's ${formatUsd(priceCents)}. I couldn't find the shipping cost on this page, so I can't give a total yet. Tax is added at checkout.`;
  }
  if (shippingCents === 0) return `It's ${formatUsd(priceCents)}, and shipping is free, so ${formatUsd(priceCents)} before tax. Tax is added at checkout.`;
  return `It's ${formatUsd(priceCents)} plus ${formatUsd(shippingCents)} shipping, so ${formatUsd(priceCents + shippingCents)} before tax. Tax is added at checkout.`;
}

// the on-page keys: option+shift and a letter, on any shopping page, never while typing
export const PAGE_KEYS = [
  ["R", "repeat what I said"],
  ["H", "help"],
  ["W", "where you are"],
  ["K", "what I know about what you want"],
  ["B", "back to the list"],
  ["N", "the next items"],
  ["C", "check this item"],
  ["P", "pause or resume"],
];

// keys: the shortcuts as chrome has them set right now, in spoken words
export function shortcutsSpeech(keys) {
  const page = PAGE_KEYS.map(([letter, what]) => `${letter} for ${what}`).join(", ");
  return [
    `Anywhere in Chrome: hold ${keys.hold} and talk, or press ${keys.toggle} to start and stop listening.`,
    `${keys.stop} stops me talking. ${keys.panel} opens my side panel. ${keys.close}, pressed twice, closes me and clears the page.`,
    `On a shopping page, hold Option and Shift and press a letter: ${page}.`,
    "You can change the Chrome-wide keys in Chrome's extension shortcuts settings.",
  ].join(" ");
}

export function helpSpeech(session, keys) {
  const parts = [
    `I'm Tellr. Hold ${keys.hold} and talk, or press ${keys.toggle} once and just talk; I stop listening when you stop. A rising tone means I'm listening, a soft pulse means I'm thinking, and a bright chime means it's your turn. Two low notes mean I'm paused, and three falling notes mean I'm off.`,
  ];
  if (!session.preferences) {
    parts.push("Start by telling me what you want, like: a black jacket under eighty dollars. Or say: find black jackets on eBay.");
  } else if (!session.report) {
    parts.push("On a search page, say list them, then open number 2. On a listing, say check this item.");
  } else if (!session.review) {
    parts.push("Ask me about the item, like: is the screen cracked. When you're at checkout, say review checkout.");
  } else {
    parts.push("Say confirm for the demo order, or review checkout if anything changed.");
  }
  parts.push("Any time, you can say: say that again, or help. Say just search to skip my questions, or what do you know to hear everything I remember about what you want.");
  parts.push(
    "Say stop talking to make me quiet. Say pause to take a break; I'll remember everything until you talk to me again. Say close when you're finished; I'll clear the page and what we found. Say keyboard shortcuts to hear the keys. Say where am I to hear what page you're on.",
  );
  return parts.join(" ");
}

const LIST_PAGE = 5;

// numbered list of search results to read aloud, five at a time
// intro: optional opening sentence for the first page (e.g. the budget screening summary)
export function resultsSpeech(results, offset = 0, intro = null) {
  const slice = results.slice(offset, offset + LIST_PAGE);
  if (!slice.length) return "That's all the items I can read on this page.";
  const opening = offset === 0 ? (intro ?? `I can read ${results.length} item${results.length === 1 ? "" : "s"} on this page.`) : "";
  // what each item is like (from its photo) beats its brand-heavy title for someone who can't see it
  const lines = slice.map((item, i) =>
    item.description
      ? `Number ${offset + i + 1}, ${formatUsd(item.priceCents)}: ${item.description.replace(/\s*$/, "").replace(/([^.!?])$/, "$1.")}`
      : `Number ${offset + i + 1}: ${item.title}, ${formatUsd(item.priceCents)}.`,
  );
  const left = results.length - (offset + slice.length);
  const tail = left > 0 ? `Say more for the next ${Math.min(left, LIST_PAGE)}, or open a number.` : "Say open and a number to pick one.";
  return [opening, ...lines, tail].filter(Boolean).join(" ");
}

export const RESULTS_PAGE_SIZE = LIST_PAGE;

// ids read aloud as plain words, at most three sentences
function plainSpeech(text) {
  const clean = String(text ?? "")
    .replace(/\s*\((?:ev-\d+(?:,\s*)?)+\)/gi, "")
    .replace(/\b(?:img|photo)[_-](\d+)\b/gi, "photo $1")
    .replace(/\s+in photo \d+\b/gi, "")
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  return sentences.slice(0, 3).join(" ").trim();
}

export function firstSentence(text) {
  // evidence ids like "(ev-2)" help on screen but are noise when spoken
  const clean = String(text ?? "")
    .replace(/\s*\((?:ev-\d+(?:,\s*)?)+\)/gi, "")
    // photo ids read aloud as "photo 1", not "img underscore 1"
    .replace(/\b(?:img|photo)[_-](\d+)\b/gi, "photo $1")
    .trim();
  const match = clean.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : clean;
}

// spoken version stays short: a full report is over a minute of audio, which is slow to hear
// and slow to download on venue wifi. every detail is still listed in the side panel.
// reminder: a few words naming an item the shopper already heard described. then the full
// overview is skipped and only the findings are read; it stays in the side panel.
export function inspectionSpeech(report, { reminder = "" } = {}) {
  // lead with what the item is like (the inspection's plain-language overview), then the verdicts
  const overview = report.evidence?.[0]?.sourceType === "photo" ? plainSpeech(report.evidence[0].observation) : "";
  const parts = [
    reminder ? `Here's what the photos show on ${reminder}.` : overview || "I looked at the listing photos and description.",
  ];
  for (const assessment of report.assessments ?? []) {
    const status = EVIDENCE_STATUS[assessment.status];
    parts.push(`${status ? status.label : assessment.status}. ${firstSentence(assessment.explanation)}`);
  }
  const questions = report.sellerQuestions ?? [];
  if (questions.length) {
    const more = questions.length > 1 ? ` I have ${questions.length - 1} more seller question${questions.length > 2 ? "s" : ""} in the side panel.` : "";
    parts.push(`Ask the seller: ${questions[0]}${more}`);
  }
  parts.push("Full details are in the side panel.");
  return parts.join(" ");
}

export function requirementLabel(requirement) {
  return (ATTRIBUTE_LABEL[requirement.attribute] ?? humanize(requirement.attribute)).toLowerCase();
}

const STATUS_WEIGHT = { supported: 2, seller_claimed: 1, unknown: 0, contradicted: -3 };
const STATUS_PHRASE = {
  supported: (label) => `${label} looks right`,
  seller_claimed: (label) => `${label} is only the seller's word`,
  unknown: (label) => `${label} can't be told from the photos`,
  contradicted: (label) => `${label} doesn't match`,
};

// how well one inspected item fits: evidence for a requirement counts up, a mismatch counts down hard
export function fitScore(report) {
  return (report?.assessments ?? []).reduce((sum, a) => sum + (STATUS_WEIGHT[a.status] ?? 0), 0);
}

function shortTitle(title) {
  const clean = String(title || "item").replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57).replace(/\s+\S*$/, "")}...` : clean;
}

// what to call an item out loud: the start of its plain description ("a flat slip-on shoe with a
// pointed toe") when there is one, otherwise its title
// a few words to remind the shopper which item this is, after its full description was heard:
// "a slip-on loafer in medium brown leather, lightly worn…" -> "the slip-on loafer in medium brown leather"
export function reminderName(item) {
  const described = String(item?.description || "").trim();
  if (!described) return shortTitle(item?.title);
  const clause = described
    .split(/[.!?;,]\s|\s(?:with|that|which|and|but|where|so)\s/i)[0]
    .replace(/^(?:a|an|the|this|these|some|a pair of)\s+/i, "")
    .split(/\s+/)
    .slice(0, 7)
    .join(" ");
  return `the ${clause.charAt(0).toLowerCase()}${clause.slice(1)}`;
}

export function spokenName(item) {
  const described = String(item?.description || "").trim();
  if (!described) return shortTitle(item?.title);
  const first = described.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "");
  // end at a natural pause: up to the first two comma-separated parts
  const parts = first.split(/,\s+/);
  const clause = parts[0].length > 90 ? parts[0] : parts.slice(0, 2).join(", ");
  return clause.charAt(0).toLowerCase() + clause.slice(1);
}

// spoken summary of a side-by-side check. checked: [{ number, title, priceCents, report }],
// failed: [{ number, reason }]. best fit first; ties go to the lower price.
export function compareSpeech(checked, failed, requirements) {
  const byId = new Map((requirements ?? []).map((r) => [r.id, r]));
  const ranked = [...checked].sort((a, b) => fitScore(b.report) - fitScore(a.report) || a.priceCents - b.priceCents);
  const describe = (entry) => {
    const notes = entry.report.assessments
      .map((a) => (byId.has(a.requirementId) ? STATUS_PHRASE[a.status]?.(requirementLabel(byId.get(a.requirementId))) : null))
      .filter(Boolean);
    return `number ${entry.number}, ${spokenName(entry)}, ${formatUsd(entry.priceCents)}${notes.length ? `: ${notes.join("; ")}` : ""}.`;
  };
  const parts = [`I checked ${checked.length} item${checked.length === 1 ? "" : "s"}.`];
  if (ranked.length) {
    parts.push(`Best fit: ${describe(ranked[0])}`);
    for (const entry of ranked.slice(1)) parts.push(`Then ${describe(entry)}`);
  }
  for (const miss of failed) parts.push(`I couldn't check number ${miss.number}: ${miss.reason}.`);
  if (ranked.length) parts.push(`Say open number ${ranked[0].number} to go to it, or ask me to compare others.`);
  return parts.join(" ");
}
