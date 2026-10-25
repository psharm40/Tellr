// the real side panel page, drawn in headless chrome with stand-in extension apis (a simulated
// session, not the live extension): saved items must show up in the "Your saved items" table.
// run: node --test extension/tests/panel.test.mjs   (skips if chrome isn't installed)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { domOf, haveChrome, startServer } from "./browser.mjs";

let server;
let origin;

before(async () => {
  if (haveChrome) ({ server, origin } = await startServer());
});

after(() => server?.close());

test("saved items appear in the side panel as a table, with open and remove buttons", { skip: !haveChrome }, async () => {
  const dom = await domOf(`${origin}/sidepanel.html?stub`);
  const saved = dom.slice(dom.indexOf('id="saved"'), dom.indexOf("</table>", dom.indexOf('id="saved"')));
  assert.ok(saved.includes("2 saved"), saved.slice(0, 300));
  assert.match(saved, /1\. brown slip-on loafer in soft leather<\/th><td>\$26\.00<\/td><td>Good pick<\/td><td>Unknown: the size isn't shown\.<\/td>/);
  assert.match(saved, /2\. black ankle boots<\/th><td>\$41\.00<\/td><td>Risky<\/td><td>The toes look scuffed\.<\/td>/);
  assert.match(saved, /aria-label="Open saved 1"/);
  assert.match(saved, /aria-label="Remove saved 2"/);
});
