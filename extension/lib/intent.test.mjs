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
  assert.equal(classifyIntent("what's the total with shipping?", onItem), "review");
  assert.equal(classifyIntent("actually size 9", onItem), "refine");
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
  assert.equal(classifyIntent("actually show me size 9 instead", onItem), "refine");
  assert.equal(classifyIntent("find black boots on ebay", onItem), "find");
  assert.equal(classifyIntent("show me other options", onItem), "choose");
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
  assert.equal(classifyIntent("review checkout", onItem), "review");
  assert.equal(classifyIntent("what's the total?", onItem), "review");
  // the demo confirm is unchanged
  assert.equal(classifyIntent("confirm the demo order", onItem), "confirm");
});

test("pausing keeps everything; ending asks first", () => {
  assert.equal(classifyIntent("stop speaking", shopping), "pause");
  assert.equal(classifyIntent("stop", shopping), "pause");
  assert.equal(classifyIntent("hold on", shopping), "pause");
  assert.equal(classifyIntent("give me a minute", shopping), "pause");
  assert.equal(classifyIntent("okay, pause", shopping), "pause");
  // not a pause: a whole sentence that merely contains "stop"
  assert.notEqual(classifyIntent("stop showing me boots", shopping), "pause");
  assert.equal(classifyIntent("resume", { ...shopping, paused: true }), "resume");
  assert.equal(classifyIntent("I'm back", { ...shopping, paused: true }), "resume");
  // "continue" without a pause still means more results
  assert.equal(classifyIntent("continue", { ...shopping, results: [{}] }), "more");
  assert.equal(classifyIntent("I'm done shopping for today", shopping), "end");
  assert.equal(classifyIntent("I give up", shopping), "end");
  assert.equal(classifyIntent("that's all for today", shopping), "end");
  // "I'm done with these" is not ending the session
  assert.notEqual(classifyIntent("I'm done with these boots", shopping), "end");
  const asked = { ...shopping, pendingEnd: true };
  assert.equal(classifyIntent("yes", asked), "end-confirm");
  assert.equal(classifyIntent("no", asked), "end-cancel");
  assert.equal(classifyIntent("just pause", asked), "pause");
  assert.equal(classifyIntent("keep it", asked), "pause");
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

test("shut up pauses; close or turn off turns tellr off", () => {
  assert.equal(classifyIntent("shut up", shopping), "pause");
  assert.equal(classifyIntent("shut up and close", shopping), "off");
  assert.equal(classifyIntent("turn off", shopping), "off");
  assert.equal(classifyIntent("close tellr", shopping), "off");
  assert.equal(classifyIntent("go away", shopping), "off");
  assert.equal(classifyIntent("close", shopping), "off");
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
