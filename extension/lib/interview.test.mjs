// run: node --test extension/lib/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_PREFERENCE, SKIP_ASKING, answerFits, answersSoFar, normalizeSize, profileLine, sizeKindIn, sizeStatement, askable, basicQuestion, missingBasics, recapSpeech, topicOf, wasAsked } from "./interview.js";

test("questions are grouped by topic, however they're worded", () => {
  assert.equal(topicOf("What shoe size do you wear?"), "size");
  assert.equal(topicOf("Do you know your size?"), "size");
  assert.equal(topicOf("What's the most you'd like to spend?"), "budget");
  assert.equal(topicOf("What's your budget?"), "budget");
  assert.equal(topicOf("Would you rather have a flat shoe or a low heel?"), "heel");
  assert.equal(topicOf("What will you wear them for, like work or going out?"), "style");
  assert.equal(topicOf("How much wear is okay with you?"), "condition");
  assert.ok(topicOf("Do you need a charger included?").startsWith("q:"));
});

test("a topic is never asked twice, whichever part of tellr asks", () => {
  const asked = [{ topic: "size", question: "What shoe size do you wear?", answer: "8" }];
  assert.ok(wasAsked(asked, "Do you know your shoe size?"));
  assert.deepEqual(askable(asked, ["What size are you?", "Would you rather have a flat shoe or a low heel?"]), ["Would you rather have a flat shoe or a low heel?"]);
  // two questions on one topic in the same batch: only the first
  assert.deepEqual(askable([], ["Flat or heel?", "Do you want a heel?"]), ["Flat or heel?"]);
});

test("the basics are asked in order until known: item, size for things you wear, budget, style", () => {
  const shoes = { category: "women's shoes", maxTotalCents: null, requirements: [] };
  assert.deepEqual(missingBasics(shoes, "I want women's shoes", []), ["size", "budget", "style"]);
  assert.deepEqual(missingBasics(shoes, "women's shoes size 8 under 40 dollars", []), ["style"]);
  assert.deepEqual(missingBasics({ ...shoes, requirements: [{ attribute: "occasion", value: "work" }] }, "size 8", [{ topic: "budget" }]), []);
  // a laptop has no size question
  assert.deepEqual(missingBasics({ category: "laptop", maxTotalCents: 50000, requirements: [] }, "a laptop under 500", []), ["style"]);
  // nothing known yet
  assert.deepEqual(missingBasics({ category: "item", requirements: [] }, "help me shop", []), ["item", "budget", "style"]);
  // an asked topic is never missing again, even if the answer was "doesn't matter"
  assert.deepEqual(missingBasics(shoes, "shoes", [{ topic: "size" }, { topic: "budget" }, { topic: "style" }]), []);
  assert.equal(basicQuestion("size", shoes), "What shoe size do you wear?");
});

test("skip words and no-preference answers are recognized", () => {
  for (const said of ["just search", "that's enough, search now", "stop asking"]) assert.match(said, SKIP_ASKING);
  for (const said of ["doesn't matter", "no preference", "any", "I don't know", "whatever"]) assert.match(said, NO_PREFERENCE);
  assert.doesNotMatch("any brown pair under 40", NO_PREFERENCE);
});

test("all answers so far, and a read-back of what tellr knows", () => {
  const asked = [{ topic: "size", question: "What shoe size do you wear?", answer: "size 8" }, { topic: "style", question: "What will you wear them for?", answer: "work" }];
  assert.equal(answersSoFar(asked), "Answers the shopper already gave (keep all of these): What shoe size do you wear? -> size 8; What will you wear them for? -> work");
  const recap = recapSpeech({ category: "women's shoes", maxTotalCents: 4000, requirements: [] }, asked, () => "", () => "Budget up to $40");
  assert.ok(recap.startsWith("You're looking for women's shoes. Budget up to $40."), recap);
  assert.ok(recap.includes("You said: work."));
  assert.equal(recapSpeech(null, [], () => "", () => ""), "I don't know anything yet. Tell me what you're shopping for.");
});

test("a reply that doesn't fit the question isn't taken as its answer", () => {
  assert.ok(answerFits("size", "8"));
  assert.ok(answerFits("size", "medium"));
  assert.ok(answerFits("size", "doesn't matter"));
  assert.ok(!answerFits("size", "actually I want boots"));
  assert.ok(answerFits("budget", "around 40 dollars"));
  assert.ok(answerFits("budget", "fifty bucks"));
  assert.ok(!answerFits("budget", "brown ones"));
  // open questions take any reply
  assert.ok(answerFits("style", "for work"));
});

test("sizes are remembered in one form, from answers or plain statements", () => {
  assert.equal(normalizeSize("size 8"), "8");
  assert.equal(normalizeSize("8 and a half"), "8.5");
  assert.equal(normalizeSize("medium"), "M");
  assert.equal(normalizeSize("extra large"), "XL");
  assert.equal(normalizeSize("no preference"), "");
  assert.deepEqual(sizeStatement("my shoe size is 8"), { kind: "shoe", size: "8" });
  assert.deepEqual(sizeStatement("I wear a medium in tops"), { kind: "top", size: "M" });
  assert.deepEqual(sizeStatement("I'm a size 10"), { kind: null, size: "10" });
  assert.equal(sizeStatement("I want brown shoes"), null);
  assert.equal(profileLine("shoe", "8"), "The shopper's usual shoe size: size 8");
  assert.equal(profileLine(null, "8"), "");
});

test("which kind of item a size is for, from the words", () => {
  assert.equal(sizeKindIn("forget my shoe size"), "shoe");
  assert.equal(sizeKindIn("forget my pants size"), "bottom");
  assert.equal(sizeKindIn("forget my sizes"), null);
});
