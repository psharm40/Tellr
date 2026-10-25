// turns the shopper's requirements into a marketplace search, like typing into the site's
// search bar and pressing enter. plain logic, unit-tested.
import { keywordsFrom, priceBounds, withoutNegated } from "./screen.js";

export const SITE_NAME = { ebay: "eBay", amazon: "Amazon" };

export function siteOf(url) {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)ebay\./i.test(host)) return "ebay";
    if (/(^|\.)amazon\./i.test(host)) return "amazon";
  } catch {
    // not a web page
  }
  return null;
}

// "women's shoes" + brown + size 8 + leather -> "brown leather women's shoes size 8".
// several colors ("black or brown") are left out: a search needs every word, which would hide
// both; results are ranked by color afterwards instead.
// the specific kind of item the shopper named last ("loafers", "tank top"), when the model's
// category is broader ("women's shoes", "tops")
const SPECIFIC = /\b((?:tank|crop|tube|halter)\s+tops?|t-?shirts?|blouses?|cardigans?|hoodies?|sweatshirts?|sweaters?|camisoles?|loafers?|flats|ballet flats|boots|ankle boots|booties|sneakers|heels|pumps|sandals|mules|clogs|oxfords|slippers|jeans|leggings|shorts|skirts?|blazers?|parkas?|backpacks?|totes?|crossbody bags?|wallets?)\b/gi;
const GENERIC = /\b(shoes|footwear|clothing|clothes|tops|top|bags|accessories|items?)\b/i;

// how to search, from what was said: buy it now unless they want auctions (bidding is hard to
// follow by voice), new or used only when they say so, cheapest first when they ask
export function searchFilters(said) {
  // "no auctions" means buy it now; "not used" is not a request for used
  const text = withoutNegated(said);
  return {
    buyItNow: !/\b(auctions?|bid|bidding)\b/i.test(text) && !/\b(?:turn off|remove|drop|disable|clear|no|without) (?:the )?buy it now\b/i.test(String(said || "")),
    condition: /\b(brand new|new with tags|nwt|new in box|unworn|new condition|only new|just new)\b/i.test(text)
      ? "new"
      : /\b(used|pre-?owned|secondhand|second-hand|second hand|thrift(?:ed)?|vintage)\b/i.test(text)
        ? "used"
        : null,
    cheapestFirst: /\b(cheapest|cheaper|lowest price|least expensive|low to high|best price)\b/i.test(text),
  };
}

export function buildSearch(preferences, said) {
  let category = String(preferences?.category || "").trim();
  if (!category || /^(item|items|something|anything)$/i.test(category)) return null;
  const words = keywordsFrom(said, preferences).map((w) => w.label);
  const colors = words.filter((w) => !/^size /.test(w) && !MATERIAL_SET.has(w));
  const color = colors.length === 1 ? colors[0] : "";
  const material = words.find((w) => MATERIAL_SET.has(w)) || "";
  const size = words.find((w) => /^size /.test(w)) || "";
  const specific = [...withoutNegated(said).matchAll(SPECIFIC)].at(-1)?.[1]?.toLowerCase();
  if (specific && !category.toLowerCase().includes(specific)) {
    category = GENERIC.test(category) ? category.replace(GENERIC, specific) : category;
  }
  const lower = category.toLowerCase();
  const query = [lower.includes(color) ? "" : color, lower.includes(material) ? "" : material, category, size]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { query, ...priceBounds(said, preferences?.maxTotalCents ?? null), filters: searchFilters(said) };
}

// does the newest thing the shopper said change what to search for? only a new item type,
// color, size, material, price, or a clear "find something else" does. an occasion or style
// ("something more for work", "casual and classy") re-judges the items already found instead.
// decided here in code, because the model rewords the item type a little on every turn.
const ITEM_NOUN = /\b(shoes?|sneakers?|trainers?|boots?|booties|loafers?|heels?|flats?|sandals?|pumps?|clogs?|mules?|oxfords?|slippers?|wedges?|jackets?|coats?|blazers?|dress(?:es)?|skirts?|shirts?|blouses?|tops?|sweaters?|hoodies?|pants|trousers|jeans|shorts|bags?|purses?|handbags?|backpacks?|wallets?|watch(?:es)?|laptops?|phones?|tablets?|headphones?|men'?s|women'?s|kids'?|girls'?|boys'?)\b/i;
const COLOR_WORD = /\b(black|white|gr[ae]y|silver|gold|red|maroon|burgundy|pink|orange|yellow|green|olive|blue|navy|teal|purple|brown|tan|beige|cream|ivory|camel|nude|multicolou?r)\b/i;
const CHANGE_WORD = /\b(find|search|look for|show me (?:other|more|different)|something else|different (?:ones?|pair|item|kind)|another (?:pair|kind)|instead|start over|cheaper|cheapest|auctions?|brand new|used|pre-?owned)\b/i;

export function changesSearch(latest) {
  const said = String(latest || "");
  if (ITEM_NOUN.test(said) || COLOR_WORD.test(said) || CHANGE_WORD.test(said)) return true;
  if (keywordsFrom(said, null).length) return true;
  const { minCents, maxCents } = priceBounds(said, null);
  return minCents != null || maxCents != null;
}

const MATERIAL_SET = new Set(["leather", "suede", "canvas", "wool", "cotton", "denim", "silk", "linen", "cashmere", "nylon", "polyester", "patent", "mesh", "velvet"]);

// the results page the site's own search bar would open. ebay also takes the price range.
export function searchUrl(site, search) {
  const filters = search.filters || {};
  const min = search.minCents ?? null;
  const max = search.maxCents ?? null;
  if (site === "amazon") {
    const params = new URLSearchParams({ k: search.query });
    // amazon's price refinement is in cents: p_36:min-max
    if (min !== null || max !== null) params.set("rh", `p_36:${min ?? ""}-${max ?? ""}`);
    if (filters.cheapestFirst) params.set("s", "price-asc-rank");
    return `https://www.amazon.com/s?${params}`;
  }
  const params = new URLSearchParams({ _nkw: search.query });
  if (min !== null) params.set("_udlo", String(Math.floor(min / 100)));
  if (max !== null) params.set("_udhi", String(Math.ceil(max / 100)));
  if (filters.buyItNow) params.set("LH_BIN", "1");
  if (filters.condition === "new") params.set("LH_ItemCondition", "1000");
  if (filters.condition === "used") params.set("LH_ItemCondition", "3000");
  // price plus shipping, lowest first
  if (filters.cheapestFirst) params.set("_sop", "15");
  return `https://www.ebay.com/sch/i.html?${params}`;
}

export function sameSearch(a, b) {
  return Boolean(a && b) && a.query === b.query && a.minCents === b.minCents && a.maxCents === b.maxCents && JSON.stringify(a.filters || {}) === JSON.stringify(b.filters || {});
}

const dollars = (cents) => `$${Math.round(cents / 100)}`;

// "brown women's shoes size 8, from $20 to $30"
export function describeSearch(search) {
  const { minCents: min, maxCents: max } = search;
  const price =
    min != null && max != null ? `, from ${dollars(min)} to ${dollars(max)}` : max != null ? `, up to ${dollars(max)}` : min != null ? `, from ${dollars(min)}` : "";
  const f = search.filters || {};
  const extras = [f.condition ? `${f.condition} only` : "", f.cheapestFirst ? "cheapest first" : ""].filter(Boolean);
  return `${search.query}${price}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}
