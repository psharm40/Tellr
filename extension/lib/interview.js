// the questions tellr asks to learn what the shopper needs, and their answers, kept in code:
// a topic is asked once, ever, for a goal, whichever part of tellr thought of the question; every
// answer is kept and sent along with later requests, so short replies ("8") keep their meaning.
// plain logic, unit-tested.
import { keywordsFrom, priceBounds } from "./screen.js";
import { topicFromText } from "./session.js";

// what a question is about. anything else is its own topic (its words), so it's still asked once.
const TOPICS = [
  ["item", /\b(what (?:kind|type) of (?:item|thing|product)|what are you (?:shopping|looking) for|what would you like to buy)\b/i],
  ["size", /\b(size|sizes|what fits|measurements?)\b/i],
  // before budget: "how much wear is okay?" is about condition
  ["condition", /\b(condition|wear and tear|how much wear|worn|scuffs?|new or used|brand new)\b/i],
  ["budget", /\b(budget|spend|price range|how much|most you'?d)\b/i],
  ["color", /\b(colou?rs?)\b/i],
  ["heel", /\b(heels?|flats?|flat shoe)\b/i],
  ["style", /\b(style|occasion|use (?:it|them) for|wear (?:it|them) for|for work|casual|dressy|formal|going out|everyday)\b/i],
  ["material", /\b(materials?|leather|suede|fabric|cotton|wool)\b/i],
  ["fit", /\b(wide|narrow|width|loose|tight|snug)\b/i],
];

export function topicOf(question) {
  const said = String(question || "");
  return TOPICS.find(([, pattern]) => pattern.test(said))?.[0] || `q:${said.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()}`;
}

// asked: [{ topic, question, answer }]
export function wasAsked(asked, question) {
  const topic = topicOf(question);
  return (asked || []).some((entry) => entry.topic === topic);
}

// only questions whose topic hasn't been asked yet, so nothing is asked twice
export function askable(asked, questions) {
  const seen = new Set((asked || []).map((entry) => entry.topic));
  return (questions || []).filter((question) => {
    const topic = topicOf(question);
    if (!question || seen.has(topic)) return false;
    seen.add(topic);
    return true;
  });
}

// "just search", "that's enough": stop asking and search with what's known
export const SKIP_ASKING = /\b(just search|search now|go ahead and search|start (?:the )?search|that'?s enough|skip (?:the )?questions?|stop asking|no more questions|search anyway)\b/i;
// "doesn't matter", "any": an answer that says there's no preference
export const NO_PREFERENCE = /^(?:(?:it )?doesn'?t matter|no preference|any(?:thing)?(?: is fine)?|either(?: is fine)?|whatever|i don'?t (?:know|care|mind)|not sure|skip(?: it| that)?|no idea)[.!]*$/i;

// speech-to-text often writes a short reply as words: "Eight.", "eight and a half"
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
export function wordsToDigits(text) {
  return String(text || "").replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\b(\s+and a half)?/gi, (_, word, half) => `${NUMBER_WORDS[word.toLowerCase()]}${half ? ".5" : ""}`);
}

// does a reply fit the question it follows? a size needs a size, a budget an amount. a reply that
// doesn't fit ("actually I want boots") is a new statement, not the answer.
const FITS = {
  size: /\d|\b(xx?s|xx?l|small|medium|large|petite|plus)\b/i,
  budget: /\d|\$|\b(dollars?|bucks|cheap|no limit|any price|hundred|fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\b/i,
};
export function answerFits(topic, reply) {
  return NO_PREFERENCE.test(String(reply || "").trim()) || !FITS[topic] || FITS[topic].test(wordsToDigits(reply));
}

// a reply that's only a size ("8", "Eight.", "size 8 wide", "medium"), as a size: "8 wide", "M"
export function sizeAnswer(reply) {
  // punctuation goes, but not the point in "8.5"
  const said = wordsToDigits(reply).toLowerCase().replace(/(?<!\d)[.!?,]+|[.!?,]+(?!\d)/g, " ").replace(/\s+/g, " ").trim();
  const width = said.match(/\b(wide|narrow)\b|^\d{1,2}(?:\.5)?\s*(w|n)$/)?.slice(1).find(Boolean);
  const core = said
    .replace(/^(?:(?:i usually wear|i wear|i'?m|i am|it'?s|usually|a|an|about|size|women'?s|men'?s)\s+)*/, "")
    .replace(/(?<=\d)\s*(?:w|n)$|\s*\b(?:wide|narrow)$/, "")
    .trim();
  const size = normalizeSize(core);
  if (!size || normalizeSize(core.replace(/^size\s*/, "")) !== size || core.split(" ").length > 3) return "";
  return width ? `${size} ${/^n/.test(width) ? "narrow" : "wide"}` : size;
}

const WEARABLE = new Set(["shoe", "top", "bottom", "dress", "outerwear", "hat"]);

// the basics, in the order they're asked: the kind of item, the size (for things you wear), the
// budget, and the style or use. a basic is known when the shopper said it or was already asked.
export function missingBasics(preferences, saidSoFar, asked) {
  const topics = new Set((asked || []).map((entry) => entry.topic));
  const category = String(preferences?.category || "").trim();
  const requirements = preferences?.requirements || [];
  const has = (pattern) => requirements.some((r) => pattern.test(String(r.attribute)));
  const missing = [];
  if (!category || /^(item|items|something|anything)$/i.test(category)) missing.push("item");
  const wearable = WEARABLE.has(topicFromText(category) || topicFromText(saidSoFar));
  const sizeSaid = keywordsFrom(saidSoFar, null).some((word) => /^size /.test(word.label)) || has(/size/i);
  if (wearable && !sizeSaid) missing.push("size");
  const bounds = priceBounds(saidSoFar, preferences?.maxTotalCents ?? null);
  if (bounds.maxCents == null && bounds.minCents == null && preferences?.maxTotalCents == null) missing.push("budget");
  if (!has(/style|occasion|use|purpose|formal|casual|dress|heel|activity/i)) missing.push("style");
  return missing.filter((topic) => !topics.has(topic));
}

// one short, plain question per basic
export function basicQuestion(topic, preferences) {
  const category = String(preferences?.category || "").toLowerCase();
  const kind = topicFromText(category);
  if (topic === "item") return "What kind of item are you looking for?";
  if (topic === "size") return kind === "shoe" ? "What shoe size do you wear?" : "What size do you usually wear?";
  if (topic === "budget") return "What's the most you'd like to spend?";
  if (WEARABLE.has(kind)) return "What will you wear them for, like work, everyday, or going out?";
  return "What will you use it for, or is there a style you like?";
}

// --- the shopper's usual sizes, remembered across shopping sessions (on this computer only) ---

// what each kind of item is called when tellr talks about its size
export const SIZE_KIND_NAME = { shoe: "shoe", top: "top", bottom: "pants", dress: "dress", outerwear: "jacket", hat: "hat" };
const KIND_WORDS = [
  ["shoe", /\b(shoes?|sneakers?|boots?|heels|sandals?|loafers?|flats)\b/i],
  ["top", /\b(tops?|shirts?|t-?shirts?|blouses?|sweaters?|hoodies?|tank)\b/i],
  ["bottom", /\b(pants|jeans|trousers|shorts|skirts?|leggings)\b/i],
  ["dress", /\b(dress|dresses)\b/i],
  ["outerwear", /\b(jackets?|coats?|blazers?)\b/i],
  ["hat", /\b(hats?|caps?|beanies?)\b/i],
];

// the kind of item a sentence names by a clothing word ("shoe", "pants"), else null
export function sizeKindIn(text) {
  return KIND_WORDS.find(([, pattern]) => pattern.test(String(text || "")))?.[0] || null;
}

// "medium" -> "M", "8 and a half" -> "8.5", so it reads as a size everywhere ("size M", "size 8.5")
export function normalizeSize(value) {
  const said = wordsToDigits(value).toLowerCase().replace(/[.!?,]+$/, "").replace(/^size\s*/, "").trim();
  const words = { "extra small": "XS", small: "S", medium: "M", large: "L", "extra large": "XL", "x large": "XL", "double extra large": "XXL" };
  if (words[said]) return words[said];
  const half = said.match(/^(\d{1,2})(?:\.5| and a half)$/);
  if (half) return `${half[1]}.5`;
  const plain = said.match(/^(\d{1,2}|xx?s|xx?l|s|m|l)\b/i);
  return plain ? plain[1].toUpperCase() : "";
}

// "my shoe size is 8", "I wear a medium", "I'm a size 10": { kind or null, size }, else null
export function sizeStatement(text) {
  const said = String(text || "");
  const match = said.match(/\b(?:my (?:usual |normal |regular )?(?:([a-z-]+) )?size is\s+|i (?:usually |normally )?wear (?:a |an )?(?:size )?|i'?m (?:a |an )?(?:size )?)((?:extra |x |double extra )?(?:small|medium|large)|\d{1,2}(?:\.5| and a half)?|xx?s|xx?l|s|m|l)\b/i);
  if (!match) return null;
  const size = normalizeSize(match[2]);
  if (!size) return null;
  const kindWord = `${match[1] || ""} ${said}`;
  const kind = KIND_WORDS.find(([, pattern]) => pattern.test(kindWord))?.[0] || null;
  return { kind, size };
}

// the line added to what's sent to claude and searched, when the shopper didn't say a size
export function profileLine(kind, size) {
  return kind && size ? `The shopper's usual ${SIZE_KIND_NAME[kind] || kind} size: size ${size}` : "";
}

// every answer so far, short, for the top of what's sent to claude: nothing is lost when an
// older part of the conversation is trimmed
export function answersSoFar(asked) {
  const answered = (asked || []).filter((entry) => entry.answer);
  if (!answered.length) return "";
  return `Answers the shopper already gave (keep all of these): ${answered.map((entry) => `${entry.question} -> ${entry.answer}`).join("; ")}`;
}

// "what do you know about what i want?": everything remembered, in plain words
export function recapSpeech(preferences, asked, describeRequirement, budgetText) {
  if (!preferences && !(asked || []).some((entry) => entry.answer)) {
    return "I don't know anything yet. Tell me what you're shopping for.";
  }
  const parts = [];
  if (preferences?.category) parts.push(`You're looking for ${preferences.category}.`);
  if (preferences) parts.push(`${budgetText(preferences)}.`);
  const wants = (preferences?.requirements || []).map((r) => describeRequirement(r));
  if (wants.length) parts.push(`You want: ${wants.join("; ")}.`);
  const answers = (asked || []).filter((entry) => entry.answer).map((entry) => `${entry.question} You said: ${entry.answer}.`);
  if (answers.length) parts.push(`Your answers: ${answers.join(" ")}`);
  parts.push("To change anything, just say it, like: make it size 9.");
  return parts.join(" ");
}
