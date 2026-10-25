// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordsFrom, priceBounds, screenResults, screeningSummary } from "./screen.js";

test("price limits from the shopper's words", () => {
  assert.deepEqual(priceBounds("brown shoes 20-30 price range", 3000), { minCents: 2000, maxCents: 3000 });
  assert.deepEqual(priceBounds("between $20 and $30"), { minCents: 2000, maxCents: 3000 });
  assert.deepEqual(priceBounds("20 to 30 dollars"), { minCents: 2000, maxCents: 3000 });
  assert.deepEqual(priceBounds("at least $15"), { minCents: 1500, maxCents: null });
  assert.deepEqual(priceBounds("under $40"), { minCents: null, maxCents: 4000 });
  // claude's budget wins over an earlier range ("actually up to 40")
  assert.deepEqual(priceBounds("20-30... actually up to 40", 4000), { minCents: 2000, maxCents: 4000 });
  assert.deepEqual(priceBounds("brown loafers size 8"), { minCents: null, maxCents: null });
});

test("keywords: colors from requirements, last size said, materials", () => {
  const prefs = { requirements: [{ attribute: "color", value: "black or brown" }] };
  const words = keywordsFrom("loafers size 7, actually size 8, leather please", prefs).map((w) => w.label);
  assert.deepEqual(words, ["black", "brown", "size 8", "leather"]);
});

test("budget removes, keywords only rank", () => {
  const results = [
    { title: "Black Sneakers Size 9", priceCents: 2500 },
    { title: "Brown Leather Loafers Women's 8", priceCents: 2800 },
    { title: "Designer Brown Boots Size 8", priceCents: 9000 },
    { title: "Tan Flats", priceCents: 1200 },
    { title: "Brown Suede Mules", priceCents: 2200 },
  ];
  const prefs = { requirements: [{ attribute: "color", value: "brown" }] };
  const words = keywordsFrom("brown shoes size 8 leather", prefs);
  const bounds = { minCents: 2000, maxCents: 3000 };
  const screened = screenResults(results, bounds, words);
  assert.equal(screened.tooHigh, 1);
  assert.equal(screened.tooLow, 1);
  assert.deepEqual(screened.fit.map((r) => r.title), [
    "Brown Leather Loafers Women's 8",
    "Brown Suede Mules",
    "Black Sneakers Size 9",
  ]);
  assert.deepEqual(screened.fit[0].matches, ["brown", "size 8", "leather"]);
  assert.equal(
    screeningSummary(results.length, screened, bounds, words),
    "Of 5 items, 3 fit your $20 to $30 budget, before shipping. Ones whose titles mention brown or size 8 or leather come first.",
  );
});

test("prices are spoken the way people say them", async () => {
  const { speakablePrices } = await import("./format.js");
  assert.equal(speakablePrices("Number 1, $28.00: a loafer."), "Number 1, 28 dollars: a loafer.");
  assert.equal(speakablePrices("total $60.50"), "total 60 dollars and 50 cents");
  assert.equal(speakablePrices("US $1,234.99 and $1.00 and $0.75"), "1,234 dollars and 99 cents and 1 dollar and 75 cents");
  assert.equal(speakablePrices("under $30"), "under 30 dollars");
});
