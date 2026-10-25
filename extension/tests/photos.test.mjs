// regression tests for which photos count as the listing's own (simulated store pages, not
// live sites). each page runs the real extract-page.js in headless chrome, served locally,
// with every outside host blocked so nothing is fetched from real stores.
// run: node --test extension/tests/photos.test.mjs   (skips if chrome isn't installed)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { haveChrome, resultOf, startServer } from "./browser.mjs";

let server;
let origin;

before(async () => {
  if (haveChrome) ({ server, origin } = await startServer());
});

after(() => server?.close());

// the listing's photo urls, as the page reader reports them
const photosOn = (page) => resultOf(`${origin}/tests/photos/${page}`);

const name = (url) => url.match(/ebayimg\.com\/images\/g\/([^/]+)\//)?.[1] ?? url.split("/").at(-1);

test("amazon-style page: the gallery only, not color swatches, reviews, ads, or related items", { skip: !haveChrome }, async () => {
  const photos = (await photosOn("amazon-style.html")).map(name);
  assert.deepEqual(photos, ["71black._AC_SX679_.jpg", "61back._AC_US40_.jpg", "61side._AC_US40_.jpg", "61detail._AC_US40_.jpg"]);
});

test("ebay-style page: all 5 gallery photos, including slides not loaded yet, once each", { skip: !haveChrome }, async () => {
  const photos = (await photosOn("ebay-style.html")).map(name);
  assert.deepEqual(photos, ["AAA1", "AAA2", "AAA3", "AAA4", "AAA5"]);
});

test("ebay-style page with 12 photos: all 12 found (inspection still sends at most 8)", { skip: !haveChrome }, async () => {
  const photos = await photosOn("ebay-twelve-photos.html");
  assert.equal(photos.length, 12);
  assert.ok(photos.every((url) => /\/BIG\d+\//.test(url)));
});

test("unfamiliar store: its gallery plus its own verified photo list; no banners, badges, or cards", { skip: !haveChrome }, async () => {
  const photos = (await photosOn("unfamiliar-store.html")).map(name);
  assert.deepEqual(photos, ["linen-shirt-sand_800x.jpg", "linen-shirt-sand-back_100x.jpg", "linen-shirt-sand-label.jpg"]);
});

test("metadata for another color is ignored when it doesn't include the photo on screen", { skip: !haveChrome }, async () => {
  const photos = (await photosOn("other-variant-metadata.html")).map(name);
  assert.deepEqual(photos, ["linen-shirt-sand_800x.jpg", "linen-shirt-sand-back_100x.jpg"]);
});

test("a page with no product on it reports no photos rather than guessing", { skip: !haveChrome }, async () => {
  assert.deepEqual(await photosOn("no-product-section.html"), []);
});
