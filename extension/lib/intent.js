// keyword routing only. the model is never asked to classify intent.
const CONFIRM = /\b(confirm( the)?( demo)?( order)?|place the demo|yes,? confirm|go ahead and confirm)\b/i;
const REVIEW = /\b(check( out)? the (cart|order|fees|total|checkout)|review (the )?(cart|order|fees|total|checkout)|checkout|shipping|tax|what('s| is) (the )?total)\b/i;
const PAGE = /\b(cheapest|lowest( priced)?|most expensive|highest( priced)?|how much|what('s| is) the (cheapest|lowest|price)|prices? on (this|the) page|on (this|the) page|these (shoes|items)|this page|what (shoes|items)|tell me about (this|these))\b/i;
const INSPECT = /\b(inspect|check (this|the|it|that)|look at (the )?(photo|picture|listing|item)|flaw|crack|scratch|condition|what('s| is) wrong|is (it|this) (ok|okay|safe|fine))\b/i;
const REQUIRE = /\b(i (want|need|am looking|'m looking)|looking for|find me|budget|under \$?\d|no more than|must (have|be)|required|i('m| am) shopping)\b/i;
const RESET = /\b(start over|never mind|forget that|not a laptop|not what i (want|need|asked)|that'?s not what i|wrong item)\b/i;
// sounds like a change to what the shopper wants: a size, price, color, material, wear, or "actually"
const CONSTRAINT = /\b(size|sz|\$\s?\d|\d+\s*(dollars?|bucks)|budget|under|below|up to|at most|at least|between|cheaper|price|colou?r|black|brown|white|red|blue|green|gr[ae]y|tan|beige|navy|pink|purple|yellow|orange|cream|leather|suede|canvas|wool|cotton|denim|wear|worn|scuffs?|scratch(es)?|condition|like new|used|actually|instead|only|also|prefer|rather|women'?s|men'?s|kids?)\b/i;
// "is it brown?" asks about an item; "brown is fine" changes the requirements
const QUESTION = /\?\s*$|^(is|are|does|do|did|what|which|how|can|could|will|would|has|have|tell me)\b|\b(want to know|wondering|curious|tell me|let me know|describe)\b/i;
// a break: stop talking, keep everything. whole-utterance so "stop at size 8" isn't a pause.
const PAUSE = /^(?:okay,?\s*|ok,?\s*|tellr,?\s*)?(?:(?:please|just|can you|could you)\s+)?(stop( talking| speaking| for (?:now|a (?:bit|second|minute)))?|pause|shut up|be quiet|quiet|shh+|hold on|hang on|one (?:sec|second|moment)|give me a (?:sec|second|minute)|take a break|turn off for (?:a bit|a while|a minute|now)|shut off for (?:a bit|a while|now)|that'?s enough( for now)?|pause for (?:now|a (?:bit|second|minute)))(?:,?\s*please)?[.!]*$/i;
// off for real: mic closed, panel closed, page marks gone, silent until the shortcut turns it on.
// memory stays; only "i'm done shopping" clears it. "turn off for a bit" is a pause instead.
const OFF = /\b(shut up and (?:close|go away|turn off|leave)|turn (?:yourself |tellr |it )?off|switch (?:yourself |tellr )?off|shut (?:yourself |tellr )?(?:down|off)|close (?:tellr|yourself|the app|the extension|the assistant)|go away|exit tellr|quit tellr|tellr off|goodbye tellr|bye tellr)\b|^(?:close|exit|quit|off|close it)[.!]*$/i;
const FOR_A_BIT = /\bfor (?:a bit|a while|a minute|a second|a sec|now)\b/i;
// "are you there?": what tellr is doing right now, so silence is never a mystery
const STATUS = /\b(are you (?:still )?(?:there|working|done|listening|on|alive|ok(?:ay)?)|what are you doing|what'?s (?:happening|going on)|is (?:it|tellr|anything) (?:working|happening)|did you hear me|hello tellr|tellr\?|still there)\b|^(?:hello|hey|hi)\??[.!]*$/i;
// "where am i?": what page this is, read out
const WHERE = /\b(where am i|what page (?:is this|am i on)|what am i looking at|describe (?:this|the) page|what site is this)\b/i;
const RESUME = /^(?:okay,?\s*|ok,?\s*)?(resume|continue|go on|keep going|i'?m back|start again|unpause|carry on|let'?s (?:continue|keep going)|where were we)\b/i;
// done for good: clears everything, after a check
const END = /\b(i'?m (?:all )?done(?: shopping)?(?: for (?:today|now|the day|tonight))?$|done shopping|that'?s all(?: for (?:today|now|tonight))?$|i give up|i'?m finished(?: shopping)?$|end (?:the |this )?session|quit shopping|stop shopping|no more (?:recommendations|suggestions|shopping))/i;
// a question about a number tellr already read off checkout: answer it, don't re-run the review
const MONEY_WORD = /\b(tax|taxes|shipping|delivery|fees?|total|subtotal|cost|costs|charge|charged|price|add-?ons?)\b/i;
const WHY = /\b(why|how come|where (?:did|does|is)|what(?:'s| is) (?:the|that)|is that (?:right|correct)|that (?:seems|looks|sounds)|seems (?:high|wrong|like a lot)|so (?:high|much))\b/i;
// facts printed on the listing, by topic. read as written, not judged by the model
const FACT_INTENTS = [
  ["seller", /\b(trust|trustworthy|legit|legitimate|scam|scammer|reliable|reputation|feedback|uncomfortable|seller(?:'s)? (?:rating|ratings|reviews|history|record|stats)|safe (?:to buy|seller)|is (?:this|the) seller (?:good|ok|okay|safe|real|any good)|who is (?:the|this) seller|about (?:the|this) seller)\b/i],
  ["popularity", /\b(popular|popularity|how many (?:sold|have (?:been )?sold|people|are left|left|watch)|watch(?:ing|ers)|in demand|selling fast|how many (?:are )?available|in stock|stock left)\b/i],
  ["returns", /\b(returns|return policy|can i return|return (?:it|them|this)|send it back|refunds?)\b/i],
  ["shipping", /\b(ships? from|located|where (?:is it|does it) (?:coming|ship|shipping) from|handling time|how long (?:to|will it take to|until it) (?:ship|arrive)|when (?:will|would) it (?:arrive|come))\b/i],
  ["payment", /\b(payment options|pay later|afterpay|klarna|financing|pay in installments)\b/i],
  ["condition", /\b(listed condition|stated condition|seller says (?:about )?(?:the )?condition|condition (?:the )?seller (?:says|listed|gave))\b/i],
  ["specifics", /\b(item (?:details|specifics)|specs|specifications|details (?:on|in) the listing|what does the listing say)\b/i],
  ["all", /\b(tell me everything|everything (?:on|about) (?:this|the) (?:page|listing|item)|all the (?:info|information|details)|what else (?:is on|does) (?:this|the) (?:page|listing)|more (?:info|information|details) (?:on|about|from) (?:this|the) (?:page|listing))\b/i],
];
const SEARCH_SETTING = /\b(cheapest (?:ones? )?first|sort(?:ed)? by price|low(?:est)? to high(?:est)?|(?:used|pre-?owned|secondhand|second hand) (?:is|are) (?:fine|okay|ok|good)|(?:only|just) (?:new|used|brand new)|(?:brand )?new only|used only|no auctions|auctions? (?:are|is) (?:fine|okay|ok)|buy it now only)\b/i;
// wants to buy or get to checkout. tellr only moves to the button; the shopper presses it.
const BUY = /\b(how (?:do|can|would) i (?:buy|purchase|order|check ?out|get (?:it|this|them))|(?:take|bring|get) me to (?:the )?(?:checkout|check out|cart|basket)|go to (?:the )?(?:checkout|check out|cart)|add (?:it|this|them)? ?to (?:my |the )?(?:cart|bag|basket)|(?:i(?:'ll| will| want to| wanna)? )(?:buy|purchase|order) (?:it|this|these|them|that)|buy (?:it|this) now|where(?:'s| is) (?:the )?(?:buy|checkout|cart) button)\b/i;
// clearly asking for something else, not about the item that's open
const NEW_SEARCH = /\b(find|search|look for|show me (?:other|more|different)|other (?:ones|options|pairs|items)|something else|different (?:ones?|pair|item)|another (?:one|pair|item)|go back|back to (?:the )?(?:results|list|search)|actually|instead|start over)\b/i;

// whole-utterance phrases, so "help me find a jacket" stays a shopping request
const HELP = /^(?:hey,? )?(?:tellr,? )?(help( me)?|what can (i|you) (say|do|ask)( here| now)?|what (now|next)|what do i (do|say)( now| next)?|how does this work|what are (the|my) commands|commands)[?.!]*$/i;
const REPEAT = /^(?:sorry,? )?(say (that|it) again|repeat( that| it)?( please)?|what did you( just)? say|come again|pardon( me)?|one more time)[?.!]*$/i;
// looser form for short asks like "can you repeat what you said" or "repeat the last part"
const REPEAT_LOOSE = /\b(repeat|say (that|it) again|what did you( just)? say)\b/i;
const LIST = /\b(list (them|the (items|results|products))|read (me )?(the )?(results|items|list|options)|what('s| is) on (this|the) (page|list)|what (items|results) are (there|here)|what are the (results|choices))\b/i;
const MORE = /^(more|next|next ones|keep going|read more|go on|continue)[?.!]*$/i;
const FIND = /\b(?:find|search(?: for)?|look for|shop for|show me)\b\s+(?:me\s+)?(.+?)\s+on\s+(ebay|amazon)\b/i;
const OPEN_VERB = /\b(open|go to|pick|choose|select|inspect|check|look at|take me to)\b/i;
const YES = /^(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|confirm)\b/i;
// pointing at items in the list without a number: "the one with the red bow", "the cheaper ones",
// "those", "the less worn pair", "the boots". claude works out which numbers are meant.
const REFERENCE = /\b(ones?|pairs?|options?|those|these|th(?:is|at) one|cheapest|least expensive|most expensive|lowest|highest|cheaper|pricier|less worn|least worn|most worn|newest|best|nicest|with (?:a|an|the)|that has|which (?:ones?|has|have)|the [a-z]+s)\b/i;
// talk about the item that's open: its wear, look, feel, condition, parts, or just "it"
const ITEM_TALK = /\b(wear|worn|tear|damage|looks?|looking|describe|feel|feels|comfortable|comfy|condition|quality|colou?r|material|stains?|scuffs?|scratch(?:es)?|creas(?:e|es|ing)|heels?|soles?|toes?|insoles?|laces?|photos?|pictures?|it|its|this (?:one|item|pair|shoe|boot)|these)\b/i;
const CHOOSE_VERB = /^(?:i(?:'ll| will| want to| wanna)?\s+)?(?:open|select|pick|choose|go with|take|show me|tell me about|which|compare|check|look at|i like)\b/i;
const NO = /^(no|nope|cancel|stop|don'?t|do not|never ?mind|wait|not yet)\b/i;

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "number 2", "item 3", "the second one", "2nd" -> 1-based index, else null
export function parseItemNumber(text) {
  const spoken = String(text || "").toLowerCase();
  const digits = spoken.match(/\b(?:number|item|result|option|no\.?)\s*(\d{1,2})\b/) || spoken.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (digits) return Number(digits[1]);
  const word = spoken.match(/\b(?:number|item|result|option)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/) ||
    spoken.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
  if (word) return ORDINAL_WORDS[word[1]];
  const bare = spoken.match(/^\s*(?:open|pick|choose|select)\s+(\d{1,2})\b/);
  return bare ? Number(bare[1]) : null;
}

const COUNT_WORDS = { two: 2, three: 3, both: 2 };
export const MAX_COMPARE = 3;

// "compare the top 3", "check numbers 1 to 3", "check 1, 2 and 4", "compare the first two"
// -> list of 1-based item numbers (at most MAX_COMPARE), else null
export function parseCompareList(text) {
  const spoken = String(text || "").toLowerCase();
  if (!/\b(compare|check|inspect|look at)\b/.test(spoken)) return null;
  // "the top 3", "those 3 options", "these two", "all three", "compare them", "compare the options"
  const top =
    spoken.match(/\b(?:top|first|those|these|the|all)\s+(\d{1,2}|two|three)\b(?!\s*(?:dollars?|bucks|\$))/) ||
    (/\bcompare\s+(?:them|these|those|all|(?:the|my)\s+options|(?:them|these|those)\s+all)\b/.test(spoken) && ["", "3"]);
  if (top) {
    const n = Math.min(MAX_COMPARE, Number(top[1]) || COUNT_WORDS[top[1]] || MAX_COMPARE);
    return Array.from({ length: n }, (_, i) => i + 1);
  }
  const span = spoken.match(/\bnumbers?\s+(\d{1,2})\s+(?:to|through|-)\s+(\d{1,2})\b/);
  if (span) {
    const [from, to] = [Number(span[1]), Number(span[2])];
    if (to > from) return Array.from({ length: Math.min(MAX_COMPARE, to - from + 1) }, (_, i) => from + i);
  }
  const listed = spoken.match(/\b(?:numbers?|items?)?\s*(\d{1,2})(?:\s*,\s*|\s+and\s+|\s+)(\d{1,2})(?:(?:\s*,\s*|\s*,?\s+and\s+)(\d{1,2}))?\b/);
  if (listed && /\b(compare|numbers?|and|,)\b/.test(spoken)) {
    return [...new Set(listed.slice(1).filter(Boolean).map(Number))].slice(0, MAX_COMPARE);
  }
  return null;
}

// "find black jackets under $100 on ebay" -> { site: "ebay", query: "black jackets" }
export function parseSiteSearch(text) {
  const match = String(text || "").match(FIND);
  if (!match) return null;
  const query = match[1]
    .replace(/\b(?:that (?:are|is)|which (?:are|is))?\s*(?:under|below|less than|no more than|for under|up to)\s*\$?\s*[\d,.]+\s*(?:dollars?|bucks)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return query ? { site: match[2].toLowerCase(), query } : null;
}

export function classifyIntent(text, session) {
  const spoken = text.trim();
  if (!spoken) return "empty";
  // "are you done shopping?" only accepts yes, no, or pause
  if (session.pendingEnd) {
    if (PAUSE.test(spoken) || /\b(keep|break)\b/i.test(spoken)) return "pause";
    if (NO.test(spoken)) return "end-cancel";
    if (YES.test(spoken) || END.test(spoken)) return "end-confirm";
  }
  if (OFF.test(spoken) && !FOR_A_BIT.test(spoken)) return "off";
  if (STATUS.test(spoken)) return "status";
  if (PAUSE.test(spoken)) return "pause";
  if (session.paused && RESUME.test(spoken)) return "resume";
  // a pending demo confirmation only accepts a clear yes or no
  if (session.pendingConfirm) {
    if (NO.test(spoken)) return "cancel-confirm";
    if (YES.test(spoken) || CONFIRM.test(spoken)) return "confirm";
  }
  if (END.test(spoken)) return "end";
  if (HELP.test(spoken)) return "help";
  if (WHERE.test(spoken)) return "where";
  if (REPEAT.test(spoken) || (REPEAT_LOOSE.test(spoken) && spoken.split(/\s+/).length <= 8)) return "repeat";
  if (RESET.test(spoken)) return "reset";
  if (parseSiteSearch(spoken)) return "find";
  if (MORE.test(spoken)) return session.results?.length ? "more" : "list";
  if (LIST.test(spoken)) return "list";
  if (parseCompareList(spoken)?.length > 1) return "compare";
  if (OPEN_VERB.test(spoken) && parseItemNumber(spoken) !== null) return "open";
  if (CONFIRM.test(spoken)) return "confirm";
  if (BUY.test(spoken)) return "buy";
  for (const [topic, pattern] of FACT_INTENTS) if (pattern.test(spoken)) return `facts:${topic}`;
  if (session.checkout && MONEY_WORD.test(spoken) && (WHY.test(spoken) || QUESTION.test(spoken)) && !/\b(review|check) (the )?(checkout|cart|order)\b/i.test(spoken)) {
    return "checkout-question";
  }
  // how to search, not which item: "cheapest first", "used is fine", "only new", "no auctions"
  if (session.preferences && SEARCH_SETTING.test(spoken)) return "refine";
  // on a single item's page, questions about it go to that item and never start a new search:
  // inspect it if it hasn't been, otherwise answer from the inspection
  // statements count too ("I want to know about the wear and tear"): only a clear new search
  // ("find…", "show me other…", "actually size 9") leaves the item
  // "which ones…", "the others", "those" point back at the list, not at the open item
  const aboutList = /\b(which ones?|the ones|ones|options|those|the others|others|cheaper|cheapest|number \d+)\b/i.test(spoken);
  if (session.onListing && !REVIEW.test(spoken) && ITEM_TALK.test(spoken) && !NEW_SEARCH.test(spoken) && !aboutList) {
    return session.report ? "explain" : "inspect";
  }
  // the same question on a results page ("how's the wear on this one?") must not start a search;
  // inspect asks which item. questions about several ("which ones look comfy?") go to choose.
  if (QUESTION.test(spoken) && ITEM_TALK.test(spoken) && !REFERENCE.test(spoken) && !REVIEW.test(spoken) && session.preferences) {
    return session.report ? "explain" : "inspect";
  }
  // pointing at listed items by description ("the one with the red bow", "the cheaper ones").
  // budget or size changes still go to the requirements, and checkout words to the review.
  if (
    session.results?.length &&
    (REFERENCE.test(spoken) || CHOOSE_VERB.test(spoken)) &&
    !REVIEW.test(spoken) &&
    !/\b(looking for|actually|instead|budget|size \d|\d+\s*(?:dollars?|bucks)|under \$?\d|up to)\b/i.test(spoken)
  ) {
    return "choose";
  }
  // still choosing (nothing inspected yet): "size 8", "up to 25 dollars", "scratches are okay"
  // update the requirements. checked before inspect, which also listens for "scratch" and "condition".
  const choosing = session.preferences && !session.report;
  if (choosing && CONSTRAINT.test(spoken) && !QUESTION.test(spoken)) return "refine";
  // a clear change of plan ("actually size 9", "up to 40 instead") searches again, even after inspecting
  if (session.preferences && /\b(actually|instead|size \d|\d+\s*(?:dollars?|bucks)|budget|under \$?\d|up to)\b/i.test(spoken) && !QUESTION.test(spoken)) {
    return "refine";
  }
  if (REVIEW.test(spoken)) return "review";
  if (PAGE.test(spoken)) return "page";
  if (INSPECT.test(spoken)) return "inspect";
  if (REQUIRE.test(spoken) || !session.preferences) return choosing ? "refine" : "requirements";
  if (session.report) return "explain";
  // while choosing, anything else is most likely more detail about what they want
  if (choosing) return "refine";
  // never guess: reading random prices for an unclear request confused shoppers
  return "unclear";
}
