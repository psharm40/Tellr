// screens search results against the shopper's budget and ranks them by their own words.
// plain logic, no chrome apis, so it is unit-tested. titles are often incomplete, so
// keywords only rank results; only the budget removes them.

const NUM = String.raw`\$?\s*(\d{1,6}(?:\.\d{1,2})?)`;
const toCents = (value) => Math.round(Number(value) * 100);

// price limits stated in the shopper's words. the budget max from claude wins when present.
export function priceBounds(text, maxTotalCents = null) {
  const said = String(text || "").toLowerCase().replace(/,/g, "");
  let min = null;
  let max = null;
  const range =
    said.match(new RegExp(String.raw`between\s+${NUM}\s*(?:dollars?)?\s+and\s+${NUM}`)) ||
    said.match(new RegExp(String.raw`${NUM}\s*(?:dollars?|bucks)?\s*(?:-|–|to)\s*${NUM}`));
  if (range) {
    min = toCents(range[1]);
    max = toCents(range[2]);
  }
  const atLeast = said.match(new RegExp(String.raw`(?:at least|over|above|more than|minimum(?: of)?)\s+${NUM}`));
  if (atLeast) min = toCents(atLeast[1]);
  const atMost = said.match(new RegExp(String.raw`(?:under|below|less than|at most|no more than|up to|max(?:imum)?(?: of)?)\s+${NUM}`));
  if (atMost) max = toCents(atMost[1]);
  if (Number.isInteger(maxTotalCents) && maxTotalCents > 0) max = maxTotalCents;
  if (min !== null && max !== null && min > max) min = null;
  return { minCents: min, maxCents: max };
}

const MATERIALS = ["leather", "suede", "canvas", "wool", "cotton", "denim", "silk", "linen", "cashmere", "nylon", "polyester", "patent", "mesh", "velvet"];

// "flat shoes, no heels" -> "flat shoes, ": what the shopper rules out is never searched for.
// a negation reaches to the next comma, full stop, "but", or "and" ("not black but brown").
// prices are read separately, so "no more than 30 dollars" still sets the budget.
const NEGATED = /\b(?:no|not|without|except|minus|avoid|never|nothing|anything but|rather not|instead of|(?:do ?n[o']t|don'?t|doesn'?t|won'?t) (?:want|need|like|care for))\b[^,.;!?]*?(?=$|[,.;!?]|\b(?:but|and)\b)/gi;

export function withoutNegated(text) {
  return String(text || "").replace(NEGATED, " ");
}

// the shopper's own words worth looking for in titles: colors, size, material
export function keywordsFrom(text, preferences) {
  const said = withoutNegated(text).toLowerCase();
  const words = [];
  for (const req of preferences?.requirements ?? []) {
    if (req.attribute === "color" && typeof req.value === "string") {
      for (const color of req.value.toLowerCase().split(/\s*(?:,|\bor\b|\band\b|\/)\s*/)) {
        if (color.trim()) words.push({ label: color.trim(), pattern: new RegExp(`\\b${escape(color.trim())}\\b`, "i") });
      }
    }
  }
  // the last size mentioned wins, so "size 7... actually 8" uses 8
  // "size 8", "size is 8", "size: 8", "size of 8"
  const sizes = [...said.matchAll(/\bsize\s*(?:is\s+|of\s+|:\s*)?(\d{1,2}(?:\.5)?|xx?s|xx?l|s|m|l)\b/g)];
  const size = sizes.at(-1)?.[1];
  if (size) {
    words.push({
      label: `size ${size}`,
      pattern: /^\d/.test(size)
        ? new RegExp(String.raw`\b(?:size|sz|us|uk|eu|women'?s)\s*${escape(size)}(?:\.0)?\b|\b${escape(size)}(?:\.0)?\s*(?:us|m|w)\b`, "i")
        : new RegExp(String.raw`\b(?:size\s*)${escape(size)}\b`, "i"),
    });
  }
  for (const material of MATERIALS) {
    if (new RegExp(`\\b${material}\\b`).test(said)) words.push({ label: material, pattern: new RegExp(`\\b${material}\\b`, "i") });
  }
  return words;
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// keeps results inside the price limits and puts titles that mention more of the shopper's
// words first. ties keep the page's own order.
export function screenResults(results, bounds, keywords) {
  const scored = results.map((item, index) => {
    const matches = keywords.filter((word) => word.pattern.test(item.title)).map((word) => word.label);
    return { ...item, matches, index };
  });
  const tooHigh = scored.filter((item) => bounds.maxCents !== null && item.priceCents > bounds.maxCents);
  const tooLow = scored.filter((item) => bounds.minCents !== null && item.priceCents < bounds.minCents);
  const fit = scored
    .filter((item) => !tooHigh.includes(item) && !tooLow.includes(item))
    .sort((a, b) => b.matches.length - a.matches.length || a.index - b.index)
    .map((item) => {
      const { index: _index, ...rest } = item;
      void _index;
      return rest;
    });
  return { fit, tooHigh: tooHigh.length, tooLow: tooLow.length };
}

const dollars = (cents) => `$${Math.round(cents / 100)}`;

// the spoken sentence that explains the screening before the numbered list
export function screeningSummary(total, screened, bounds, keywords) {
  if (bounds.maxCents === null && bounds.minCents === null) {
    return `I can read ${total} item${total === 1 ? "" : "s"}.`;
  }
  const budget =
    bounds.minCents !== null && bounds.maxCents !== null
      ? `${dollars(bounds.minCents)} to ${dollars(bounds.maxCents)}`
      : bounds.maxCents !== null
        ? `up to ${dollars(bounds.maxCents)}`
        : `at least ${dollars(bounds.minCents)}`;
  const parts = [`Of ${total} items, ${screened.fit.length} fit your ${budget} budget, before shipping.`];
  const mentioned = keywords.map((word) => word.label);
  if (screened.fit.length && mentioned.length && screened.fit[0].matches.length) {
    parts.push(`Ones whose titles mention ${mentioned.join(" or ")} come first.`);
  }
  return parts.join(" ");
}
