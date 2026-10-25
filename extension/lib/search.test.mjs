// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearch, changesSearch, describeSearch, searchFilters, searchUrl, siteOf } from "./search.js";

const shoes = {
  category: "women's shoes",
  maxTotalCents: 3000,
  requirements: [
    { attribute: "color", value: "brown" },
    { attribute: "cosmetic_scratches", value: true },
  ],
};

test("requirements become a search with the price range", () => {
  const search = buildSearch(shoes, "women's shoes, brown, minimal to okay wear, 20-30 dollars, size 8");
  assert.deepEqual(search, {
    query: "brown women's shoes size 8",
    minCents: 2000,
    maxCents: 3000,
    filters: { buyItNow: true, condition: null, cheapestFirst: false },
  });
  assert.equal(describeSearch(search), "brown women's shoes size 8, from $20 to $30");
  assert.equal(
    searchUrl("ebay", search),
    "https://www.ebay.com/sch/i.html?_nkw=brown+women%27s+shoes+size+8&_udlo=20&_udhi=30&LH_BIN=1",
  );
  assert.equal(searchUrl("amazon", search), "https://www.amazon.com/s?k=brown+women%27s+shoes+size+8&rh=p_36%3A2000-3000");
});

test("several colors stay out of the search; materials go in once", () => {
  const prefs = { ...shoes, requirements: [{ attribute: "color", value: "black or brown" }] };
  // the specific kind named ("loafers") replaces the broad category ("shoes")
  assert.equal(buildSearch(prefs, "leather loafers, black or brown").query, "leather women's loafers");
  const named = { ...shoes, category: "brown leather boots" };
  assert.equal(buildSearch(named, "brown leather boots").query, "brown leather boots");
});

test("no search without a real item type", () => {
  assert.equal(buildSearch({ category: "item", requirements: [] }, "something nice"), null);
  assert.equal(buildSearch(null, "x"), null);
});

test("which marketplace a tab is on", () => {
  assert.equal(siteOf("https://www.ebay.com/itm/123"), "ebay");
  assert.equal(siteOf("https://www.amazon.com/s?k=x"), "amazon");
  assert.equal(siteOf("https://mail.google.com/"), null);
  assert.equal(siteOf("chrome://newtab/"), null);
});

test("a style or occasion answer re-judges; a new item, color, size, or price searches again", () => {
  for (const said of ["something a bit more for work", "casual and classy", "I want them comfortable for walking", "something I can wear to the office", "dressier"]) {
    assert.equal(changesSearch(said), false, said);
  }
  for (const said of ["actually show me boots", "in black", "size 9", "under 40 dollars", "find something else", "leather ones"]) {
    assert.equal(changesSearch(said), true, said);
  }
});

test("the search fits the request: kind, filters, sorting", () => {
  const tops = { category: "women's tops", maxTotalCents: 2000, requirements: [{ attribute: "color", value: "black" }] };
  const search = buildSearch(tops, "a black tank top under 20 dollars, cheapest first, used is fine");
  assert.equal(search.query, "black women's tank top");
  assert.deepEqual(search.filters, { buyItNow: true, condition: "used", cheapestFirst: true });
  assert.match(searchUrl("ebay", search), /LH_BIN=1&LH_ItemCondition=3000&_sop=15$/);
  assert.match(searchUrl("amazon", search), /s=price-asc-rank/);
  assert.equal(buildSearch(tops, "black tank top, auctions are fine").filters.buyItNow, false);
});

test("what the shopper rules out never becomes a search term", () => {
  const shoes = { category: "women's shoes", maxTotalCents: 3000, requirements: [] };
  assert.equal(buildSearch(shoes, "women's shoes size 8. flat shoes, no heels").query, "women's shoes size 8");
  assert.equal(buildSearch(shoes, "loafers, not boots").query, "women's loafers");
  assert.equal(buildSearch(shoes, "I don't want boots, loafers are better").query, "women's loafers");
  assert.equal(buildSearch(shoes, "something without heels, under 30 dollars").query, "women's shoes");
  assert.equal(buildSearch(shoes, "no leather, suede is fine").query, "suede women's shoes");
  assert.equal(buildSearch(shoes, "not size 7, size 8").query, "women's shoes size 8");
  // filters: "no auctions" keeps buy it now; "not used" doesn't ask for used
  assert.equal(searchFilters("no auctions please").buyItNow, true);
  assert.equal(searchFilters("auctions are fine").buyItNow, false);
  assert.equal(searchFilters("not used, only new").condition, "new");
  // a budget phrased with "no" still counts
  assert.equal(buildSearch(shoes, "no more than 30 dollars").maxCents, 3000);
  // without a negation nothing changes
  assert.equal(buildSearch(shoes, "low heels in brown leather").query, "leather women's heels");
});

test("turning the buy it now filter off allows auctions", () => {
  assert.equal(searchFilters("turn off the buy it now filter").buyItNow, false);
  assert.equal(searchFilters("no buy it now filter").buyItNow, false);
  assert.equal(searchFilters("brown loafers size 8").buyItNow, true);
});

test("after the full description, an item is named in a few words", async () => {
  const { reminderName, inspectionSpeech } = await import("./format.js");
  const item = { title: "Sam Edelman Loafer 8", description: "A slip-on loafer in medium brown leather with a small strap across the top, lightly worn on the toes." };
  assert.equal(reminderName(item), "the slip-on loafer in medium brown leather");
  assert.equal(reminderName({ description: "Black ankle boots, block heel, scuffed toes." }), "the black ankle boots");
  assert.ok(reminderName({ description: "An extremely soft and very lightweight knit pullover sweater in a pale oatmeal color" }).split(" ").length <= 8);
  // with a reminder, the inspection skips its full overview but keeps the findings
  const report = { evidence: [{ sourceType: "photo", observation: "A long overview of the whole shoe." }], assessments: [{ status: "supported", explanation: "The color is brown." }], sellerQuestions: [] };
  const brief = inspectionSpeech(report, { reminder: "the brown loafers" });
  assert.ok(brief.startsWith("Here's what the photos show on the brown loafers."));
  assert.ok(!brief.includes("A long overview"));
  assert.ok(brief.includes("The color is brown."));
  assert.ok(inspectionSpeech(report).startsWith("A long overview"));
});

test("tellr's state has one name, matching its sounds", async () => {
  const { presenceOf, PRESENCE } = await import("./format.js");
  const voice = (status) => ({ voice: { status } });
  assert.equal(presenceOf({ ...voice("listening") }), "listening");
  assert.equal(presenceOf({ ...voice("processing") }), "thinking");
  assert.equal(presenceOf({ ...voice("idle"), busy: true }), "thinking");
  assert.equal(presenceOf({ ...voice("speaking"), busy: true }), "speaking");
  assert.equal(presenceOf({ ...voice("idle") }), "ready");
  assert.equal(presenceOf({ ...voice("idle"), paused: true }), "paused");
  assert.equal(presenceOf({ ...voice("listening"), off: true }), "off");
  assert.equal(PRESENCE.ready, "Your turn");
});

test("a size said as 'size is 9' counts as a size", async () => {
  const { keywordsFrom } = await import("./screen.js");
  const sizes = (text) => keywordsFrom(text, null).filter((w) => /^size /.test(w.label)).map((w) => w.label);
  assert.deepEqual(sizes("my shoe size is 9"), ["size 9"]);
  assert.deepEqual(sizes("size: 8"), ["size 8"]);
  assert.deepEqual(sizes("size 7 then size is 8.5"), ["size 8.5"]);
  assert.deepEqual(sizes("what size is the box"), []);
});
