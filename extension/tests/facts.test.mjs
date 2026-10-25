// regression tests for reading a listing's facts into topics (shipping, returns, payment,
// condition), on simulated store pages in headless chrome. not live sites.
// run: node --test extension/tests/facts.test.mjs   (skips if chrome isn't installed)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { haveChrome, resultOf, startServer } from "./browser.mjs";

let server;
let origin;

before(async () => {
  if (haveChrome) ({ server, origin } = await startServer());
});

after(() => server?.close());

const read = (page) => resultOf(`${origin}/tests/facts/${page}`);
const values = (rows) => rows.map((row) => `${row.label}: ${row.value}`);

test("ebay: a long shipping row still gives its price, and the section is sorted by topic", { skip: !haveChrome }, async () => {
  const { shippingCents, facts } = await read("ebay-shipping-section.html");
  // the original failure: this row is longer than 120 characters, so the price was missed
  assert.equal(shippingCents, 945);
  assert.ok(values(facts.shipping).some((v) => v.startsWith("Shipping: US $9.45")), values(facts.shipping).join(" | "));
  assert.ok(values(facts.shipping).some((v) => v.startsWith("Delivery: Estimated between")));
  assert.ok(values(facts.returns).some((v) => v.startsWith("Returns: 30 days returns")));
  assert.ok(values(facts.payment).some((v) => v.startsWith("Payments: PayPal")));
});

test("unfamiliar store: label lines and a collapsible section are sorted; other notes are not", { skip: !haveChrome }, async () => {
  const { facts } = await read("store-sections.html");
  const all = Object.values(facts).flat().map((row) => `${row.label}: ${row.value}`);
  assert.ok(values(facts.shipping).includes("Delivery: 3 to 5 business days"), values(facts.shipping).join(" | "));
  assert.ok(values(facts.condition).includes("Condition: Gently used, no stains"));
  // "Shipping & Returns" is filed under one topic and keeps its full text
  assert.ok(all.some((v) => v.includes("Free standard shipping on orders over $50. Returns accepted within 30 days.")), all.join(" | "));
  // a care note and a size guide aren't one of the topics
  assert.ok(!all.some((v) => /hand wash|Runs a little large/.test(v)), all.join(" | "));
});

test("plain headings: the text under a shipping heading is read, and the price after it", { skip: !haveChrome }, async () => {
  const { shippingCents, facts } = await read("heading-sections.html");
  assert.ok(values(facts.shipping).some((v) => v.includes("Ships in 2 days by UPS.") && v.includes("Flat rate $6.00")), values(facts.shipping).join(" | "));
  assert.equal(shippingCents, 600);
  // a review that mentions money and shipping isn't a shipping fact
  assert.ok(!values(facts.shipping).some((v) => /Love this mug/.test(v)));
});

test("no shipping information: reported as unknown, never guessed", { skip: !haveChrome }, async () => {
  const { shippingCents, facts } = await read("no-shipping-info.html");
  assert.equal(shippingCents, null);
  assert.deepEqual(facts.shipping, []);
});

test("ebay: seller feedback is read word for word, and the item specifics go to claude", { skip: !haveChrome }, async () => {
  const { reviews, specifics, details, description } = await read("ebay-specifics-feedback.html");
  assert.deepEqual(
    reviews.map((r) => `${r.label}: ${r.value}`),
    // the buyer's comment itself, without the date line next to it
    ["Seller feedback: Fast shipping and the shoes were exactly as described. Thank you!", "Seller feedback: Great seller, well packed, would buy again."],
  );
  assert.ok(specifics.some((row) => row.label === "Upper Material" && row.value === "Leather"));
  // the material is in the details sent with questions, and in the listing text the photo check gets
  for (const text of [details, description]) {
    assert.ok(text.includes("Item details as written by the seller") && text.includes("Upper Material: Leather"), text.slice(0, 200));
    assert.ok(text.includes("Condition: Pre-owned"));
  }
});

test("amazon-style: customer reviews are read as item reviews", { skip: !haveChrome }, async () => {
  const { reviews } = await read("amazon-reviews.html");
  const said = reviews.map((r) => `${r.label}: ${r.value}`);
  assert.ok(said.some((v) => v.startsWith("Customer review:") && v.includes("Soft fabric and true to size")), said.join(" | "));
  assert.ok(said.some((v) => v.includes("Thin material, a bit see-through")), said.join(" | "));
  assert.ok(!said.some((v) => v.startsWith("Seller feedback")));
});

test("the seller's own description is kept word for word", { skip: !haveChrome }, async () => {
  const { sellerDescription } = await read("amazon-reviews.html");
  assert.equal(sellerDescription, "Soft ribbed cotton tank top with a scoop neck. Machine washable.");
});

test("unfamiliar store: a Reviews list is read; the care section is not a review", { skip: !haveChrome }, async () => {
  const { reviews } = await read("store-reviews.html");
  assert.deepEqual(reviews.map((r) => r.value), ["Heavy and well made, keeps coffee warm.", "The glaze chipped after a month."]);
});
