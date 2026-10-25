import test from "node:test";
import assert from "node:assert/strict";
import { captionAt } from "./caption.js";

test("caption reveals words in step with the audio", () => {
  const text = "one two three four";
  assert.equal(captionAt(text, 0, 4000), "one");
  assert.equal(captionAt(text, 2000, 4000), "one two");
  assert.equal(captionAt(text, 4000, 4000), "one two three four");
  assert.equal(captionAt(text, 9000, 4000), "one two three four");
  // a long answer shows only its latest words
  const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  assert.equal(captionAt(long, 1, 1, 3), "… w57 w58 w59");
});
