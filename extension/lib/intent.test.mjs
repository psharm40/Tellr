// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, parseCompareList, parseItemNumber, parseSiteSearch } from "./intent.js";

const fresh = { preferences: null, report: null, results: [], pendingConfirm: null };
const shopping = { preferences: { category: "jacket" }, report: null, results: [], pendingConfirm: null };

test("help and repeat only match the whole phrase", () => {
  assert.equal(classifyIntent("What can I say?", shopping), "help");
  assert.equal(classifyIntent("help", fresh), "help");
  assert.equal(classifyIntent("what now", shopping), "help");
  assert.equal(classifyIntent("help me find a black jacket under $80", fresh), "requirements");
  assert.equal(classifyIntent("say that again", shopping), "repeat");
  assert.equal(classifyIntent("Sorry, what did you say?", shopping), "repeat");
});

test("looser repeat phrasings, and unclear requests never read random prices", () => {
  assert.equal(classifyIntent("repeat what you said", shopping), "repeat");
  assert.equal(classifyIntent("can you repeat that", shopping), "repeat");
  assert.equal(classifyIntent("what did you just say", shopping), "repeat");
  // tellr asked a clarifying question, so a short reply refines the requirements
  assert.equal(classifyIntent("thirty dollars max", { ...shopping, clarificationQuestions: ["What's your max budget?"] }), "refine");
  // after something was inspected, an unmatched remark is a question about it, not a guess at prices
  assert.equal(classifyIntent("banana", { ...shopping, report: {} }), "explain");
  assert.equal(classifyIntent("what's the cheapest one on this page", shopping), "page");
});

test("while choosing, follow-up answers always update the requirements", () => {
  // the exact follow-ups that were being dropped after a search
  assert.equal(classifyIntent("size 8", shopping), "refine");
  assert.equal(classifyIntent("actually only up to 25 dollars", shopping), "refine");
  assert.equal(classifyIntent("my budget is 30", shopping), "refine");
  assert.equal(classifyIntent("scratches are okay", shopping), "refine");
  assert.equal(classifyIntent("black is fine too", shopping), "refine");
  assert.equal(classifyIntent("loafers please", shopping), "refine");
  // questions and commands still do their own thing
  assert.equal(classifyIntent("is the condition okay?", shopping), "inspect");
  assert.equal(classifyIntent("list them", shopping), "list");
  assert.equal(classifyIntent("open number 2", shopping), "open");
  // once an item was inspected, "is it brown?" is a question about it
  assert.equal(classifyIntent("is it brown?", { ...shopping, report: {} }), "explain");
});

test("site search pulls the item and drops the budget", () => {
  assert.deepEqual(parseSiteSearch("find 3 black jackets under $100 on eBay"), { site: "ebay", query: "3 black jackets" });
  assert.deepEqual(parseSiteSearch("search for a used laptop on amazon"), { site: "amazon", query: "a used laptop" });
  assert.equal(parseSiteSearch("I need a laptop under $300"), null);
  assert.equal(classifyIntent("find black jackets on ebay", fresh), "find");
});

test("item numbers in words, digits, and ordinals", () => {
  assert.equal(parseItemNumber("open number 2"), 2);
  assert.equal(parseItemNumber("open the second one"), 2);
  assert.equal(parseItemNumber("check item three"), 3);
  assert.equal(parseItemNumber("open the 4th"), 4);
  assert.equal(parseItemNumber("open 5"), 5);
  assert.equal(parseItemNumber("check this item"), null);
  assert.equal(classifyIntent("open number 2", shopping), "open");
  assert.equal(classifyIntent("inspect the third one", shopping), "open");
  assert.equal(classifyIntent("check this item", shopping), "inspect");
});

test("compare several items to narrow down", () => {
  assert.deepEqual(parseCompareList("compare the top 3"), [1, 2, 3]);
  assert.deepEqual(parseCompareList("check the first two"), [1, 2]);
  assert.deepEqual(parseCompareList("check numbers 2 to 4"), [2, 3, 4]);
  assert.deepEqual(parseCompareList("compare 1, 3 and 5"), [1, 3, 5]);
  assert.deepEqual(parseCompareList("compare number 2 and 4"), [2, 4]);
  assert.deepEqual(parseCompareList("compare the top 10"), [1, 2, 3]);
  assert.equal(parseCompareList("check this item"), null);
  assert.equal(parseCompareList("open number 2"), null);
  assert.equal(classifyIntent("compare the top 3", shopping), "compare");
  assert.equal(classifyIntent("check numbers 1 to 3", shopping), "compare");
  // a single number is still "open", not a comparison
  assert.equal(classifyIntent("check number 2", shopping), "open");
});

test("pointing at listed items the way a person would", () => {
  const listed = { ...shopping, results: [{}, {}, {}] };
  assert.equal(classifyIntent("the one with the red bow", listed), "choose");
  assert.equal(classifyIntent("open the less worn ones", listed), "choose");
  assert.equal(classifyIntent("show me the least expensive one", listed), "choose");
  assert.equal(classifyIntent("compare the brown ones", listed), "choose");
  assert.equal(classifyIntent("I'll take the boots", listed), "choose");
  assert.equal(classifyIntent("which ones are leather?", listed), "choose");
  // numbers and whole-list compares stay exact
  assert.equal(classifyIntent("compare those 3 options", listed), "compare");
  assert.deepEqual(parseCompareList("compare those 3 options"), [1, 2, 3]);
  assert.deepEqual(parseCompareList("compare them"), [1, 2, 3]);
  assert.deepEqual(parseCompareList("compare these two"), [1, 2]);
  assert.equal(classifyIntent("I select option 1", listed), "open");
  // budget and size changes still update the search; checkout words still review
  assert.equal(classifyIntent("actually the cheaper ones under 25 dollars", listed), "refine");
  assert.equal(classifyIntent("size 8 ones only", listed), "refine");
  assert.equal(classifyIntent("check the fees", listed), "review");
  // with no list read out, "the brown ones" is a requirement
  assert.equal(classifyIntent("the brown ones", shopping), "refine");
});

test("listing and more", () => {
  assert.equal(classifyIntent("list them", shopping), "list");
  assert.equal(classifyIntent("what's on this page", shopping), "list");
  assert.equal(classifyIntent("more", { ...shopping, results: [{}] }), "more");
  assert.equal(classifyIntent("more", shopping), "list");
});

test("a pending confirm takes only a clear yes or no", () => {
  const pending = { ...shopping, report: {}, pendingConfirm: { version: 1 } };
  assert.equal(classifyIntent("yes, confirm", pending), "confirm");
  assert.equal(classifyIntent("yes", pending), "confirm");
  assert.equal(classifyIntent("no, wait", pending), "cancel-confirm");
  assert.equal(classifyIntent("cancel", pending), "cancel-confirm");
  // without a pending confirm, a bare yes is not consent
  assert.notEqual(classifyIntent("yes", { ...shopping, report: {} }), "confirm");
  assert.equal(classifyIntent("confirm the demo order", shopping), "confirm");
});

test("questions about the open item go to that item, never to a new search", () => {
  const onItem = { ...shopping, results: [{}, {}, {}], onListing: true };
  // the exact question that started a new search
  assert.equal(classifyIntent("how is the wear on this item", onItem), "inspect");
  assert.equal(classifyIntent("what does it look like?", onItem), "inspect");
  assert.equal(classifyIntent("describe it", onItem), "inspect");
  assert.equal(classifyIntent("how would these feel?", onItem), "inspect");
  // once inspected, the same questions are answered from the inspection
  assert.equal(classifyIntent("how is the wear on this item", { ...onItem, report: {} }), "explain");
  assert.equal(classifyIntent("are the soles worn?", { ...onItem, report: {} }), "explain");
  // checkout words and statements still go where they did
  // on an item's page, the all-in price is added up from the page (was "review", the full
  // checkout check, which needs the item checked first); on checkout pages it's still the review
  assert.equal(classifyIntent("what's the total with shipping?", onItem), "item-total");
  assert.equal(classifyIntent("what's the total with shipping?", { ...onItem, onCheckout: true }), "review");
  // on an item, a changed requirement is saved and checked against this item first; tellr asks
  // before leaving it (was "refine", which searched away without checking)
  assert.equal(classifyIntent("actually size 9", onItem), "item-requirement");
  // on a results page, the same words don't mean "this item"
  // on a results page it still never re-searches: inspect asks which item
  assert.equal(classifyIntent("how is the wear on this item", { ...onItem, onListing: false }), "inspect");
  assert.equal(classifyIntent("which ones look comfortable?", { ...onItem, onListing: false }), "choose");
});

test("on an item's page, statements about it stay on the item too", () => {
  const onItem = { ...shopping, results: [{}, {}, {}], onListing: true, report: {} };
  assert.equal(classifyIntent("I want to know about the wear and tear", onItem), "explain");
  assert.equal(classifyIntent("tell me about the soles", onItem), "explain");
  assert.equal(classifyIntent("I'm wondering how the photos look", onItem), "explain");
  assert.equal(classifyIntent("the wear and tear on it", onItem), "explain");
  // not inspected yet: inspect it first
  assert.equal(classifyIntent("I want to know about the wear and tear", { ...onItem, report: null }), "inspect");
  // clear new searches still leave the item
  assert.equal(classifyIntent("actually show me size 9 instead", onItem), "item-requirement");
  assert.equal(classifyIntent("find black boots on ebay", onItem), "find");
  // asking for the other options leaves the item and goes back to the list (was "choose", which
  // talked about the list while the shopper stayed on the item)
  assert.equal(classifyIntent("show me other options", onItem), "back");
  // "which ones" means the list, even while an item is open
  assert.equal(classifyIntent("which ones are less worn?", onItem), "choose");
  assert.equal(classifyIntent("are those more comfortable?", onItem), "choose");
});

test("buying goes to the button, never through the q&a", () => {
  const onItem = { ...shopping, results: [{}], onListing: true, report: {} };
  assert.equal(classifyIntent("how do I buy this?", onItem), "buy");
  assert.equal(classifyIntent("take me to checkout", onItem), "buy");
  assert.equal(classifyIntent("add it to my cart", onItem), "buy");
  assert.equal(classifyIntent("I'll buy it", onItem), "buy");
  assert.equal(classifyIntent("where is the checkout button", onItem), "buy");
  // on the checkout page, the fee check is unchanged
  const atCheckout = { ...onItem, onCheckout: true };
  assert.equal(classifyIntent("review checkout", atCheckout), "review");
  assert.equal(classifyIntent("what's the total?", atCheckout), "review");
  assert.equal(classifyIntent("review checkout", onItem), "review");
  // the demo confirm is unchanged
  assert.equal(classifyIntent("confirm the demo order", onItem), "confirm");
});

test("pause keeps everything; stopping words ask pause or close", () => {
  assert.equal(classifyIntent("stop speaking", shopping), "pause");
  // a bare "stop" goes quiet and asks pause or close (was "pause")
  assert.equal(classifyIntent("stop", shopping), "leave");
  assert.equal(classifyIntent("hold on", shopping), "pause");
  assert.equal(classifyIntent("give me a minute", shopping), "pause");
  assert.equal(classifyIntent("okay, pause", shopping), "pause");
  // not a pause: a whole sentence that merely contains "stop"
  assert.notEqual(classifyIntent("stop showing me boots", shopping), "pause");
  assert.notEqual(classifyIntent("stop showing me boots", shopping), "leave");
  assert.equal(classifyIntent("resume", { ...shopping, paused: true }), "resume");
  assert.equal(classifyIntent("I'm back", { ...shopping, paused: true }), "resume");
  // "continue" without a pause still means more results
  assert.equal(classifyIntent("continue", { ...shopping, results: [{}] }), "more");
  // being done asks pause or close (was "end", which asked to clear)
  assert.equal(classifyIntent("I'm done shopping for today", shopping), "leave");
  assert.equal(classifyIntent("I give up", shopping), "leave");
  assert.equal(classifyIntent("that's all for today", shopping), "leave");
  // "I'm done with these" is not ending the session
  assert.notEqual(classifyIntent("I'm done with these boots", shopping), "leave");
  // the answer to "pause or close?"
  const asked = { ...shopping, pendingLeave: true };
  assert.equal(classifyIntent("pause", asked), "pause");
  assert.equal(classifyIntent("just pause", asked), "pause");
  assert.equal(classifyIntent("I'll come back later", asked), "pause");
  assert.equal(classifyIntent("close", asked), "close");
  assert.equal(classifyIntent("I'm finished", asked), "close");
  assert.equal(classifyIntent("no", asked), "leave-cancel");
  assert.equal(classifyIntent("keep going", asked), "leave-cancel");
});

test("questions about checkout numbers are answered, not re-reviewed", () => {
  const atCheckout = { ...shopping, checkout: { taxCents: 1499 }, review: {} };
  assert.equal(classifyIntent("why is the tax that number", atCheckout), "checkout-question");
  assert.equal(classifyIntent("why is the tax so high?", atCheckout), "checkout-question");
  assert.equal(classifyIntent("what's the shipping cost", atCheckout), "checkout-question");
  assert.equal(classifyIntent("review checkout", atCheckout), "review");
  // before any checkout is read, a money word still means review
  assert.equal(classifyIntent("what is the total", shopping), "review");
});


test("facts on the listing go by topic", () => {
  assert.equal(classifyIntent("can I trust this seller?", shopping), "facts:seller");
  assert.equal(classifyIntent("I feel uncomfortable, is this seller legit", shopping), "facts:seller");
  assert.equal(classifyIntent("how popular is this item", shopping), "facts:popularity");
  assert.equal(classifyIntent("how many people are watching this", shopping), "facts:popularity");
  assert.equal(classifyIntent("what's the return policy", shopping), "facts:returns");
  assert.equal(classifyIntent("where does it ship from", shopping), "facts:shipping");
  assert.equal(classifyIntent("tell me everything on this page", shopping), "facts:all");
});

test("shut up pauses; close or turn off closes tellr", () => {
  assert.equal(classifyIntent("shut up", shopping), "pause");
  assert.equal(classifyIntent("shut up and close", shopping), "close");
  assert.equal(classifyIntent("turn off", shopping), "close");
  assert.equal(classifyIntent("close tellr", shopping), "close");
  // "go away" sounds like stopping but not which kind: it asks (was "off")
  assert.equal(classifyIntent("go away", shopping), "leave");
  assert.equal(classifyIntent("close", shopping), "close");
  assert.equal(classifyIntent("turn off for a bit", shopping), "pause");
  assert.equal(classifyIntent("where am I", shopping), "where");
  assert.equal(classifyIntent("what page is this", shopping), "where");
});

test("checking on tellr gets a status, never a search", () => {
  assert.equal(classifyIntent("are you there?", shopping), "status");
  assert.equal(classifyIntent("what are you doing", shopping), "status");
  assert.equal(classifyIntent("hello", shopping), "status");
  assert.equal(classifyIntent("did you hear me", shopping), "status");
});

test("naming a new kind of item starts a new goal", async () => {
  const { forgetStaleGoal } = await import("./session.js");
  const shoes = { preferences: { category: "women's shoes" }, requirementsTurns: ["women's shoes size 8"], results: [{}], history: [] };
  assert.equal(forgetStaleGoal(shoes, null, "I want a black tank top").preferences, null);
  assert.equal(forgetStaleGoal(shoes, null, "no, I said a black tank top").preferences, null);
  // same kind, or the top 3, keeps the goal
  assert.ok(forgetStaleGoal(shoes, null, "brown loafers instead").preferences);
  assert.ok(forgetStaleGoal(shoes, null, "compare the top 3").preferences);
  assert.ok(forgetStaleGoal(shoes, null, "how many people watch it").preferences);
});

test("search settings update the search instead of picking an item", () => {
  const listed = { ...shopping, results: [{ title: "a", priceCents: 100 }] };
  assert.equal(classifyIntent("cheapest first, used is fine", listed), "refine");
  assert.equal(classifyIntent("only new ones", listed), "refine");
  assert.equal(classifyIntent("no auctions", listed), "refine");
  // a question about the cheapest is still a question
  assert.notEqual(classifyIntent("which one is the cheapest?", listed), "refine");
});

test("a detail of the item makes it an item question, even with listing-fact words", () => {
  const open = { ...shopping, onListing: true, report: { assessments: [] } };
  for (const said of [
    "where is the stain located",
    "where exactly is the scuff located on the shoe",
    "can I trust these photos",
    "can I trust the color in the pictures",
    "is this laptop reliable",
    "how reliable is this battery",
    "how many people have worn these",
    "tell me everything about this item",
    "what am I looking at",
  ]) {
    assert.equal(classifyIntent(said, open), "explain", said);
  }
  // not inspected yet: the same questions inspect first
  assert.equal(classifyIntent("where is the stain located", { ...open, report: null }), "inspect");
});

test("seller and listing questions still reach the listing facts", () => {
  const open = { ...shopping, onListing: true, report: { assessments: [] } };
  const cases = {
    "can I trust this seller": "facts:seller",
    "is this seller legit": "facts:seller",
    "is this legit": "facts:seller",
    "I feel uncomfortable buying this": "facts:seller",
    "how good are the seller's ratings": "facts:seller",
    "where is the seller located": "facts:seller",
    "how many people are watching this item": "facts:popularity",
    "how many have sold": "facts:popularity",
    "where is the item located": "facts:shipping",
    "where does it ship from": "facts:shipping",
    "can I return it if it doesn't fit": "facts:returns",
    "tell me everything on this page": "facts:all",
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(classifyIntent(said, open), want, said);
  // off an item's page, "what am i looking at" describes the page
  assert.equal(classifyIntent("what am I looking at", shopping), "where");
});

test("commands to tellr count only when aimed at tellr", () => {
  for (const said of ["turn off", "turn off.", "okay turn off please", "tellr, turn off", "turn yourself off", "shut up and close", "close", "close tellr"]) {
    assert.equal(classifyIntent(said, shopping), "close", said);
  }
  // goodbyes ask pause or close instead of closing outright (were "off")
  for (const said of ["go away", "bye tellr"]) assert.equal(classifyIntent(said, shopping), "leave", said);
  // the same words about something else never close or stop tellr
  for (const said of [
    "turn off the buy it now filter",
    "can you turn off the size filter",
    "close the size chart",
    "is it close to new condition",
    "is the shop closed on sundays",
  ]) {
    assert.notEqual(classifyIntent(said, shopping), "close", said);
    assert.notEqual(classifyIntent(said, shopping), "leave", said);
  }
  // "is it working?" on a laptop listing is about the laptop, not tellr
  assert.notEqual(classifyIntent("is it working?", { ...shopping, onListing: true, report: {} }), "status");
  assert.equal(classifyIntent("are you working?", shopping), "status");
});

test("never mind cancels; it never resets what the shopper wants", () => {
  for (const said of ["never mind", "Never mind.", "nevermind", "forget it", "forget that", "okay never mind", "scratch that", "cancel"]) {
    assert.equal(classifyIntent(said, shopping), "cancel", said);
  }
  // with new content, the content wins
  assert.notEqual(classifyIntent("never mind, I want brown boots", shopping), "cancel");
  assert.notEqual(classifyIntent("never mind, I want brown boots", shopping), "reset");
  // a correction asks what to change, or updates the requirements when it says what
  for (const said of ["that's not what I asked for", "that's not what I want", "wrong item", "that's wrong"]) {
    assert.equal(classifyIntent(said, shopping), "correction", said);
  }
  assert.equal(classifyIntent("that's not what I want, I want a tank top", shopping), "refine");
  // only an explicit start over drops the goal
  assert.equal(classifyIntent("start over", shopping), "reset");
  // during "confirm the demo order?", never mind still declines it
  assert.equal(classifyIntent("never mind", { ...shopping, pendingConfirm: { version: 1 } }), "cancel-confirm");
});

test("a page of other things never wipes the answers while the shopper is still answering", async () => {
  const { forgetStaleGoal } = await import("./session.js");
  const headphones = ["Wireless Earbuds Headphones", "Noise Cancelling Headphones", "Kids Headphones", "Gaming Headset Headphones"].map((title) => ({ title }));
  const answering = {
    preferences: { category: "women's loafers" },
    requirementsTurns: ["black loafers"],
    asked: [{ topic: "size", question: "What shoe size do you wear?", answer: "size 8" }],
    awaiting: { topic: "budget", question: "What's the most you'd like to spend?" },
    interviewDone: false,
    pageUrl: "https://www.amazon.com/",
    results: [],
    history: [],
  };
  // still answering, on a page of headphone deals (the home page or a results page): all kept, every turn
  for (const page of [
    { url: "https://www.amazon.com/", place: "home", pageKind: "results", products: headphones },
    { url: "https://www.amazon.com/s?k=headphones", place: "results", pageKind: "results", products: headphones },
  ]) {
    const kept = forgetStaleGoal(answering, page, "no more than $40");
    assert.equal(kept.preferences.category, "women's loafers");
    assert.deepEqual(kept.asked, answering.asked);
    assert.deepEqual(kept.awaiting, answering.awaiting);
  }
  // after the search, the home page's deals still don't count
  const searched = { ...answering, interviewDone: true, pageUrl: "https://www.amazon.com/s?k=loafers" };
  assert.ok(forgetStaleGoal(searched, { url: "https://www.amazon.com/", place: "home", pageKind: "results", products: headphones }, "list them").preferences);
  // but going to a results page of another kind, after the search, is a new goal
  const fresh = forgetStaleGoal(searched, { url: "https://www.amazon.com/s?k=headphones", place: "results", pageKind: "results", products: headphones }, "list them");
  assert.equal(fresh.preferences, null);
  assert.deepEqual(fresh.asked, []);
});

test("only a request for a different kind of item starts a new goal", async () => {
  const { forgetStaleGoal, topicFromText } = await import("./session.js");
  const shoes = { preferences: { category: "women's shoes" }, requirementsTurns: ["women's shoes size 8"], results: [{}], history: [] };
  const kept = (said) => Boolean(forgetStaleGoal(shoes, null, said).preferences);
  // the main noun decides: these are all still shoes
  for (const said of ["cap toe oxfords please", "boot style loafers", "something with a little heel", "sneakers instead"]) {
    assert.ok(kept(said), said);
  }
  // questions about the item, and things ruled out, don't switch goals
  for (const said of ["does it come with a dust bag?", "is there a box or bag included?", "I don't want a bag, just shoes", "no hats"]) {
    assert.ok(kept(said), said);
  }
  // real switches still start fresh
  for (const said of ["I want a black tank top", "no, I said a black tank top", "can you find me a tote bag?", "show me baseball caps"]) {
    assert.equal(kept(said), false, said);
  }
  assert.equal(topicFromText("boot cut jeans"), "bottom");
  assert.equal(topicFromText("a tank top to wear with my boots"), "top");
  assert.equal(topicFromText("Women's Brown Leather Penny Loafers Size 8"), "shoe");
});

test("filter changes go to the search, never to the buy button", () => {
  for (const said of ["turn off the buy it now filter", "buy it now only", "remove the size filter", "include auctions"]) {
    assert.equal(classifyIntent(said, shopping), "refine", said);
  }
  // real purchase requests still go to the buy button
  for (const said of ["take me to checkout", "buy it now", "add it to my cart"]) {
    assert.equal(classifyIntent(said, shopping), "buy", said);
  }
});

test("on one item, only an explicit ask brings the other options back", () => {
  const onItem = { ...shopping, results: [{}, {}, {}], onListing: true, report: {} };
  for (const said of ["go back", "go back to the list", "back to the results", "what are the other options", "show me the others"]) {
    assert.equal(classifyIntent(said, onItem), "back", said);
  }
  // questions and wishes about this item stay on it
  for (const said of ["is it comfortable", "something a bit more for work", "what do you think", "I like it"]) {
    assert.equal(classifyIntent(said, onItem), "explain", said);
  }
  // a wish is saved and this item is checked against it (was "explain", which didn't save it)
  assert.equal(classifyIntent("I'd rather have a flat shoe", onItem), "item-requirement");
  // pointing at other items by description still works when asked
  assert.equal(classifyIntent("which ones are less worn?", onItem), "choose");
});

test("hints on an item never suggest other numbers", async () => {
  const { nextHint } = await import("./format.js");
  const onItem = { preferences: { category: "shoes" }, results: [{}, {}], focusKey: "123", report: null, review: null };
  assert.doesNotMatch(nextHint(onItem), /open number|another number/i);
  assert.doesNotMatch(nextHint({ ...onItem, report: {} }), /open number|another number/i);
  // on the list, the hint still offers the numbers
  assert.match(nextHint({ ...onItem, focusKey: "" }), /open number 1/);
});

test("shipping questions on an item's page are answered from its shipping section", () => {
  const onItem = { ...shopping, onListing: true, report: {}, checkout: { shippingCents: null }, results: [{}] };
  for (const said of ["give me the shipping costs", "how much is shipping", "what does shipping cost for this pair", "when will it be delivered", "is shipping free"]) {
    assert.equal(classifyIntent(said, onItem), "facts:shipping", said);
  }
  // returns stay returns, even with the word shipping
  assert.equal(classifyIntent("who pays return shipping", onItem), "facts:returns");
  // totals still go to the checkout numbers
  assert.notEqual(classifyIntent("what's the total with shipping", onItem), "facts:shipping");
  // on a cart or checkout page, shipping questions go to the checkout review as before
  const atCheckout = { ...onItem, onListing: false, onCheckout: true };
  assert.equal(classifyIntent("how much is shipping", atCheckout), "checkout-question");
  assert.equal(classifyIntent("give me the shipping costs", { ...onItem, onListing: true, onCheckout: true }), "review");
});

test("shipping answers read the page's own words, or say unknown", async () => {
  const { factsSpeech } = await import("./format.js");
  const facts = { seller: [], popularity: [], condition: [], returns: [], payment: [], specifics: [], shipping: [{ label: "Shipping", value: "US $9.45 USPS Ground Advantage" }] };
  assert.equal(factsSpeech(facts, "shipping"), "Shipping: US $9.45 USPS Ground Advantage.");
  const none = { ...facts, shipping: [] };
  assert.equal(factsSpeech(none, "shipping", null, { shippingCents: 600 }), "Shipping is $6.00, from the page.");
  assert.equal(factsSpeech(none, "shipping", null, { shippingCents: null }), "I couldn't find anything about shipping on this page.");
});

test("questions about the item use its details and photos; reviews read buyers' words", async () => {
  const { isInspectCommand } = await import("./intent.js");
  const fresh = { ...shopping, onListing: true, report: null, results: [{}] };
  // material and similar questions go to the item (answered, not a full photo readout)
  for (const said of ["what is the material of the shoes", "what are they made of", "what brand is it", "are they real leather?"]) {
    const intent = classifyIntent(said, fresh);
    assert.ok(intent === "inspect" || intent === "explain", `${said} -> ${intent}`);
    assert.equal(isInspectCommand(said), false, said);
  }
  assert.equal(classifyIntent("what are they made of", { ...fresh, report: {} }), "explain");
  // only a request to check gives the full photo readout
  for (const said of ["check this item", "examine the photos", "can you check the photos", "look closer at the pictures"]) {
    assert.equal(isInspectCommand(said), true, said);
  }
  // reviews: buyers' words, seller feedback first when the seller is named
  assert.equal(classifyIntent("read me a review someone left of the seller", fresh), "facts:seller-reviews");
  assert.equal(classifyIntent("what do buyers say about this seller", fresh), "facts:seller-reviews");
  assert.equal(classifyIntent("read me some reviews", fresh), "facts:reviews");
  assert.equal(classifyIntent("what are people saying about these shoes", fresh), "facts:reviews");
  // the seller's numbers are still the rating summary
  assert.equal(classifyIntent("how are the seller's ratings", fresh), "facts:seller");
  // "review" the verb still checks the checkout
  assert.equal(classifyIntent("review checkout", fresh), "review");
});

test("reviews are read in the buyer's own words, or reported as not found", async () => {
  const { factsSpeech } = await import("./format.js");
  const base = { seller: [], popularity: [], condition: [], returns: [], shipping: [], payment: [], specifics: [] };
  const reviews = [
    { label: "Customer review", value: "Comfy but runs half a size small" },
    { label: "Seller feedback", value: "Fast shipping, item exactly as described" },
    { label: "Seller feedback", value: "Great seller, well packed" },
  ];
  const aboutSeller = factsSpeech({ ...base, reviews }, "seller-reviews");
  assert.ok(aboutSeller.startsWith("One buyer wrote about the seller: Fast shipping, item exactly as described."), aboutSeller);
  assert.ok(aboutSeller.includes("1 more in the side panel"));
  assert.ok(factsSpeech({ ...base, reviews }, "reviews").startsWith("One buyer wrote about the item: Comfy but runs half a size small."));
  assert.match(factsSpeech({ ...base, reviews: [] }, "reviews"), /couldn't find any written reviews/);
});

test("on an item, a new requirement is saved and checked against that item", () => {
  const onItem = { ...shopping, results: [{}, {}, {}], onListing: true, report: {} };
  for (const said of ["I need them to be leather", "it has to be size 9", "actually I want a flat shoe", "under 30 dollars", "they should be black"]) {
    assert.equal(classifyIntent(said, onItem), "item-requirement", said);
  }
  // an answer to tellr's question, given on an item, takes the same path
  assert.equal(classifyIntent("for work", { ...onItem, awaiting: { topic: "style", question: "What for?" } }), "item-requirement");
  // questions, and clearly leaving, are unchanged
  assert.equal(classifyIntent("is it leather?", onItem), "explain");
  assert.notEqual(classifyIntent("find something else", onItem), "item-requirement");
  assert.equal(classifyIntent("go back", onItem), "back");
  // on the results page, nothing changes: it updates the search
  assert.equal(classifyIntent("I need them to be leather", { ...onItem, onListing: false, report: null }), "refine");
  // "want me to search for ones that do?"
  const offered = { ...onItem, pendingSearch: true };
  assert.equal(classifyIntent("yes", offered), "search-confirm");
  assert.equal(classifyIntent("sure, go back", offered), "search-confirm");
  assert.equal(classifyIntent("no, stay on this one", offered), "search-cancel");
});

test("any way of saying you're stopping asks pause or close", () => {
  for (const said of [
    "stop", "I am done", "I'm done for today", "I don't want to use Tellr anymore", "I dont need you anymore",
    "I don't need your help right now", "that's all, thanks", "leave me alone", "goodbye", "I'm good for now",
    "I want to stop", "stop tellr", "I want to stop using this", "no more suggestions", "okay I'm all done",
  ]) {
    assert.equal(classifyIntent(said, shopping), "leave", said);
  }
  // about the shopping, not about stopping tellr
  for (const said of ["I want to stop at size 8", "I'm done with these boots", "stop showing me heels", "I don't want leather"]) {
    assert.notEqual(classifyIntent(said, shopping), "leave", said);
  }
  // "no thanks" can answer tellr's own question, so it doesn't count then
  assert.notEqual(classifyIntent("no thanks", { ...shopping, pendingSearch: true }), "leave");
  assert.equal(classifyIntent("no thanks", shopping), "leave");
});

test("keyboard shortcuts can be asked for and are read with the real keys", async () => {
  const { shortcutsSpeech } = await import("./format.js");
  const { holdKeyProblem } = await import("./settings.js");
  for (const said of ["what are the keyboard shortcuts", "keyboard shortcuts", "which keys can I use"]) {
    assert.equal(classifyIntent(said, shopping), "shortcuts", said);
  }
  const speech = shortcutsSpeech({ hold: "Option Space", toggle: "Option Shift L", stop: "Option Shift S", panel: "Option Shift T", close: "Option Shift X" });
  for (const part of ["hold Option Space", "Option Shift S stops me talking", "Option Shift X, pressed twice, closes me", "R for repeat what I said", "P for pause or resume"]) {
    assert.ok(speech.includes(part), part);
  }
  // the talk key can't be set to one of tellr's own shortcuts
  assert.ok(holdKeyProblem({ code: "KeyR", alt: true, shift: true, ctrl: false, meta: false }));
  assert.equal(holdKeyProblem({ code: "Space", alt: true, shift: false, ctrl: false, meta: false }), null);
});

test("the shortlist: save, read, open, compare, remove; the panel by voice", async () => {
  const { parseSavedNumber } = await import("./intent.js");
  const { shortlistSpeech } = await import("./format.js");
  const listed = { ...shopping, results: [{}, {}, {}] };
  const cases = {
    "save this one": "save",
    "save number 2": "save",
    "add it to my list": "save",
    "what's on my list": "list-saved",
    "read my saved items": "list-saved",
    "compare my saved ones": "compare-saved",
    "open saved 2": "open-saved",
    "remove saved 2": "unsave",
    "take this one off my list": "unsave",
    "open the panel": "panel",
    "close the side panel": "panel-close",
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(classifyIntent(said, listed), want, said);
  // the same words elsewhere are unchanged
  assert.equal(classifyIntent("open number 2", listed), "open");
  assert.equal(classifyIntent("compare them", listed), "compare");
  assert.equal(classifyIntent("close", listed), "close");
  assert.notEqual(classifyIntent("I want to save money", listed), "save");
  assert.equal(parseSavedNumber("open saved number two"), 2);
  assert.equal(parseSavedNumber("remove saved 3"), 3);
  assert.equal(parseSavedNumber("open number 3"), null);
  const speech = shortlistSpeech([{ title: "x", description: "A brown slip-on loafer, lightly worn", priceCents: 2600, fit: "good_pick", flaw: "", unknown: "the size isn't shown." }]);
  assert.ok(speech.startsWith("You've saved 1. Saved 1: the brown slip-on loafer, $26.00, a good pick. Still unknown: the size isn't shown."), speech);
  assert.match(shortlistSpeech([]), /Your list is empty/);
});

test("the all-in price on an item is added up in code", async () => {
  const { itemTotalSpeech } = await import("./format.js");
  const onItem = { ...shopping, results: [{}], onListing: true, report: {} };
  for (const said of ["how much with shipping", "what's the total with shipping?", "how much is it all in", "how much is it including shipping", "what will I end up paying"]) {
    assert.equal(classifyIntent(said, onItem), "item-total", said);
  }
  // shipping alone is still the shipping section
  assert.equal(classifyIntent("how much is shipping", onItem), "facts:shipping");
  assert.equal(itemTotalSpeech(2800, 945), "It's $28.00 plus $9.45 shipping, so $37.45 before tax. Tax is added at checkout.");
  assert.equal(itemTotalSpeech(2800, 0), "It's $28.00, and shipping is free, so $28.00 before tax. Tax is added at checkout.");
  assert.match(itemTotalSpeech(2800, null), /couldn't find the shipping cost/);
  assert.match(itemTotalSpeech(0, 945), /couldn't read this item's price/);
});

test("the listing's own words: description in parts, and the exact title", async () => {
  const { descriptionPart } = await import("./format.js");
  const onItem = { ...shopping, results: [{}], onListing: true, report: {} };
  for (const said of ["read me the description", "read the full description", "what does the listing say", "what did the seller write"]) {
    assert.equal(classifyIntent(said, onItem), "read-description", said);
  }
  for (const said of ["what's the exact title", "read me the title", "what is this called"]) {
    assert.equal(classifyIntent(said, onItem), "read-title", said);
  }
  // "read more" continues the description only while one is being read; otherwise it's more results
  assert.equal(classifyIntent("read more", { ...onItem, descriptionLeft: "the rest" }), "read-description-more");
  assert.equal(classifyIntent("read more", onItem), "more");
  // brand questions still go to the item (they use the item specifics)
  assert.notEqual(classifyIntent("what brand is it", onItem), "read-title");
  const long = "First sentence about the shoes. ".repeat(40);
  const first = descriptionPart(long);
  assert.ok(first.spoken.startsWith("The seller wrote: First sentence"));
  assert.ok(first.spoken.endsWith("Say read more for the rest."));
  assert.ok(first.left.length > 0);
  const short = descriptionPart("Gently worn, no box.");
  assert.equal(short.spoken, "The seller wrote: Gently worn, no box. That's the whole description.");
  assert.match(descriptionPart("").spoken, /couldn't find the seller's own description/);
});

test("your sizes: remember, read back, forget", () => {
  for (const said of ["my shoe size is 8", "I wear a medium", "I'm a size 10", "my usual size is 9"]) {
    assert.equal(classifyIntent(said, shopping), "remember-size", said);
  }
  // answering tellr's size question goes through the answer, which also remembers it
  assert.notEqual(classifyIntent("I wear an 8", { ...shopping, awaiting: { topic: "size", question: "What size?" } }), "remember-size");
  assert.equal(classifyIntent("what's my size", shopping), "what-size");
  assert.equal(classifyIntent("what sizes do you remember", shopping), "what-size");
  assert.equal(classifyIntent("forget my size", shopping), "forget-size");
  assert.equal(classifyIntent("forget my shoe size", shopping), "forget-size");
  // a size statement while tellr waits on another question is still remembered
  assert.equal(classifyIntent("my shoe size is 9", { ...shopping, awaiting: { topic: "heel", question: "Flat or heel?" } }), "remember-size");
  // a size in a shopping request is just a requirement, not a lasting change
  assert.notEqual(classifyIntent("I want brown shoes in size 9", shopping), "remember-size");
});

test("the save offer when leaving an item takes yes or no", () => {
  const offered = { ...shopping, results: [{}, {}], onListing: true, pendingSaveOffer: { entry: {}, then: { intent: "back" } } };
  for (const said of ["yes", "yeah", "save it", "sure"]) assert.equal(classifyIntent(said, offered), "save-offer-yes", said);
  for (const said of ["no", "no thanks", "skip it", "don't save"]) assert.equal(classifyIntent(said, offered), "save-offer-no", said);
  // anything else is handled as said (and the offer is dropped)
  assert.equal(classifyIntent("open number 2", offered), "open");
});

test("clearing the whole saved list asks first", () => {
  for (const said of ["clear my list", "delete my saved items", "empty the shortlist", "remove everything from my list"]) {
    assert.equal(classifyIntent(said, shopping), "clear-saved", said);
  }
  const asked = { ...shopping, pendingClearSaved: true };
  assert.equal(classifyIntent("yes", asked), "clear-saved-yes");
  assert.equal(classifyIntent("no, keep them", asked), "clear-saved-no");
  // one item is still just that one
  assert.equal(classifyIntent("remove saved 2", shopping), "unsave");
});

test("the welcome mentions saved items from before", async () => {
  const { welcomeSpeech } = await import("./format.js");
  const page = { url: "https://www.ebay.com/", place: "home", products: [] };
  const withSaved = welcomeSpeech(page, { shortlist: [{}, {}, {}] });
  assert.ok(withSaved.includes("You have 3 saved items from before. Say what's on my list to hear them."), withSaved);
  assert.ok(withSaved.endsWith("What are you shopping for today?"));
  assert.ok(!welcomeSpeech(page, { shortlist: [] }).includes("saved"));
});
