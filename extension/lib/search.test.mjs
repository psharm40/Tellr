// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearch, changesSearch, describeSearch, searchUrl, siteOf } from "./search.js";

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
