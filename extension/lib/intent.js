// keyword routing only. the model is never asked to classify intent.
const CONFIRM = /\b(confirm( the)?( demo)?( order)?|place the demo|yes,? confirm|go ahead and confirm)\b/i;
const REVIEW = /\b(check( out)? the (cart|order|fees|total|checkout)|review (the )?(cart|order|fees|total|checkout)|checkout|shipping|tax|what('s| is) (the )?total)\b/i;
const PAGE = /\b(cheapest|lowest( priced)?|most expensive|highest( priced)?|how much|what('s| is) the (cheapest|lowest|price)|prices? on (this|the) page|on (this|the) page|these (shoes|items)|this page|what (shoes|items)|tell me about (this|these))\b/i;
const INSPECT = /\b(inspect|check (this|the|it|that)|look at (the )?(photo|picture|listing|item)|flaw|crack|scratch|condition|what('s| is) wrong|is (it|this) (ok|okay|safe|fine))\b/i;
const REQUIRE = /\b(i (want|need|am looking|'m looking)|looking for|find me|budget|under \$?\d|no more than|must (have|be)|required|i('m| am) shopping)\b/i;
// only an explicit "start over" drops the goal. memory otherwise lasts until "i'm done shopping".
const RESET = /\b(start over|start from scratch)\b/i;
// stop what tellr is doing, keep everything: only when it's the whole request, so
// "never mind, I want boots" still updates the search
const CANCEL = /^(?:never ?mind|forget (?:it|that|about it)|cancel(?: that| it)?|scratch that|no wait|stop that)$/;
// "that's wrong" with nothing else: ask what to change. with more ("…, I want boots") the
// newest words update the requirements like any other answer
const CORRECTION = /^(?:no )?(?:that'?s|that is|this is|these are|those are)(?: not| the)? (?:what i (?:want|wanted|need|needed|asked(?: for)?|meant|said)|wrong(?: item| thing| ones?)?|not right)$|^(?:wrong (?:item|thing|ones?|search)|not what i (?:want|wanted|asked(?: for)?|meant))$/;
// sounds like a change to what the shopper wants: a size, price, color, material, wear, or "actually"
const CONSTRAINT = /\b(size|sz|\$\s?\d|\d+\s*(dollars?|bucks)|budget|under|below|up to|at most|at least|between|cheaper|price|colou?r|black|brown|white|red|blue|green|gr[ae]y|tan|beige|navy|pink|purple|yellow|orange|cream|leather|suede|canvas|wool|cotton|denim|wear|worn|scuffs?|scratch(es)?|condition|like new|used|actually|instead|only|also|prefer|rather|women'?s|men'?s|kids?)\b/i;
// "is it brown?" asks about an item; "brown is fine" changes the requirements
const QUESTION = /\?\s*$|^(is|are|does|do|did|what|which|how|can|could|will|would|has|have|tell me)\b|\b(want to know|wondering|curious|tell me|let me know|describe)\b/i;
// a break: stop talking, keep everything. whole-utterance so "stop at size 8" isn't a pause.
const PAUSE = /^(?:okay,?\s*|ok,?\s*|tellr,?\s*)?(?:(?:please|just|can you|could you)\s+)?(stop (?:talking|speaking|for (?:now|a (?:bit|second|minute)))|pause|shut up|be quiet|quiet|shh+|hold on|hang on|one (?:sec|second|moment)|give me a (?:sec|second|minute)|take a break|turn off for (?:a bit|a while|a minute|now)|shut off for (?:a bit|a while|now)|that'?s enough( for now)?|pause for (?:now|a (?:bit|second|minute)))(?:,?\s*please)?[.!]*$/i;
// commands to tellr itself count only when they are the whole request (fillers aside) or name
// tellr outright. "turn off the buy it now filter" is about the search, not about tellr.
function bare(spoken) {
  return spoken
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\b(okay|ok|hey|tellr|please|just|now|right now|thanks|thank you|can you|could you|would you)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// stopping tellr. two clear words decide: "pause" (quiet, remembers everything, for coming back
// soon) and "close" (finished: page marks, side panel, and this shopping session cleared).
// "close" said outright, or "turn off", closes. anything else that sounds like stopping ("stop",
// "I'm done", "I don't need you anymore", "bye") asks which of the two the shopper means.
const CLOSE_WHOLE = /^(?:shut up and (?:close|turn off|leave)|close(?: tellr| yourself| the app| the extension| the assistant| it)?|turn (?:yourself |it )?off|switch (?:yourself |it )?off|shut (?:yourself )?(?:down|off)|exit|quit|off)$/;
const CLOSE_NAMED = /\b(?:turn|switch|shut) (?:yourself|tellr) (?:off|down)\b|\b(?:close|exit|quit) (?:tellr|yourself)\b|\btellr,? (?:turn |switch |shut )?off\b/i;
function isClose(spoken) {
  return CLOSE_WHOLE.test(bare(spoken)) || CLOSE_NAMED.test(spoken);
}
// sounds like stopping, but not which kind
const LEAVE_WHOLE = /^(?:i'?m |i am |we'?re )?(?:all )?(?:done|finished|through|all set)(?: (?:now|for (?:now|today|the day|tonight)|with (?:tellr|you|this|shopping|it|everything|all this)|shopping(?: for (?:now|today|the day|tonight))?))?$|^(?:stop|enough|bye|goodbye|bye bye|see you|see ya|later|leave me alone|go away|i give up|give up)$/;
// only when tellr isn't waiting on an answer: "no thanks" can answer a question
const LEAVE_WEAK = /^(?:i'?m good(?: for now)?|that'?s (?:all|it|enough)(?: for (?:now|today|tonight))?|no thanks?|no thank you|nothing else)$/;
const LEAVE_ANYWHERE = /\b(?:don'?t|dont|do not|no longer) (?:want|need) (?:tellr|you|this|it|your help|help|to (?:use (?:tellr|this|you|it)|shop|keep (?:going|shopping)))(?: anymore| any more| right now| now| today)?\b|\b(?:stop|quit|close|exit|leave|end) (?:using )?(?:tellr|this app|the app|this extension|shopping|this session)\b|\bi (?:want|need|'?d like|would like) to (?:stop|quit|leave|be done|end|finish)(?: (?:now|shopping|using (?:tellr|this|you)))?[.!]*$|\bi give up\b|\bleave me alone\b|\bdone shopping\b|\bthat'?s all for (?:today|now|tonight)\b|\bend (?:the |this )?session\b|\bno more (?:recommendations|suggestions|shopping)\b/i;
export function isLeaving(spoken, session = {}) {
  // lighter than bare(): "now" and "for now" matter here ("I'm good for now")
  const said = spoken
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\b(?:thanks?|thank you|please|tellr)\b/g, " ")
    .replace(/^\s*(?:(?:okay|ok|hey|so|well|um|tellr)\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // "no thanks" keeps its "thanks" for this check
  const plain = spoken.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  const waiting = session.awaiting || session.pendingSearch || session.pendingConfirm;
  return LEAVE_WHOLE.test(said) || (!waiting && (LEAVE_WEAK.test(said) || LEAVE_WEAK.test(plain))) || LEAVE_ANYWHERE.test(spoken);
}
const FOR_A_BIT = /\bfor (?:a bit|a while|a minute|a second|a sec|now)\b/i;
// "are you there?": what tellr is doing right now, so silence is never a mystery
// asked of tellr ("are you", "did you", "tellr"), never "is it working?", which can be about the item
const STATUS = /\b(are you (?:still )?(?:there|working|done|listening|on|alive|ok(?:ay)?)|what are you doing|what'?s (?:happening|going on)|is (?:tellr|anything) (?:working|happening)|did you hear me|hello tellr|tellr\?|still there)\b|^(?:hello|hey|hi)\??[.!]*$/i;
// "what do you know about what i want?": everything remembered about the goal, read back
const RECAP = /\b(what do you know(?: about (?:me|what i (?:want|need)))?|what (?:have|did) i (?:tell|told) you|what am i (?:looking|shopping) for|remind me what i (?:want|said|asked for)|what are my (?:requirements|preferences|needs)|recap|summari[sz]e (?:what i want|my (?:needs|preferences)))\b/i;
// the shopper's usual sizes, kept across shopping sessions: "my shoe size is 8", "forget my size"
const MY_SIZE = /\b(?:my (?:usual |normal |regular )?(?:[a-z-]+ )?size is|i (?:usually |normally )?wear (?:a |an )?(?:size )?(?:\d|small|medium|large|extra|x|s\b|m\b|l\b)|i'?m (?:a |an )?size)\b/i;
const FORGET_SIZE = /\bforget (?:about )?(?:my |the |all my |all of my )?(?:[a-z]+ )?sizes?\b/i;
const WHAT_SIZE = /\b(?:what(?:'s| is| are) my (?:[a-z]+ )?sizes?|what sizes? do you (?:remember|know|have)|do you (?:remember|know) my sizes?)\b/i;
// the shortlist: items the shopper saves to come back to, across searches
const SAVE = /\b(save|bookmark|shortlist|favou?rite)\b(?! (?:money|time))|\badd (?:it|this|that|this one|that one|number \w+|them|those) to (?:my )?(?:list|shortlist|saved(?: items)?|favou?rites)\b|\b(?:put|keep) (?:it|this|that|this one|that one|number \w+) (?:on|in) (?:my )?(?:list|shortlist)\b/i;
// emptying the whole saved list, which lasts across sessions, so it's confirmed first
const CLEAR_SAVED = /\b(?:clear|empty|delete|erase|wipe) (?:out )?(?:my |the )?(?:whole |entire )?(?:saved )?(?:list|shortlist|saved items|saved ones|saves)\b|\bremove (?:all|everything) (?:from|on) my list\b/i;
const UNSAVE = /\b(?:remove|delete|take|drop|unsave)\b.*\b(?:from|off|out of) (?:my )?(?:list|shortlist|saved(?: items)?|favou?rites)\b|\bunsave\b|\bremove saved (?:number )?\w+\b/i;
const SAVED_WORDS = /\b(my (?:list|shortlist|saved(?: items| ones| pairs)?|favou?rites)|saved (?:items|ones|pairs|number \w+|\d+|one|two|three|four|five)|the shortlist)\b/i;
// opening the side panel needs a key press; chrome refuses a spoken request. closing works by voice.
const PANEL = /\b(open|show|bring up|pull up)(?: me)? (?:the |my |your )?(?:side )?panel\b/i;
const PANEL_CLOSE = /\b(close|hide|shut) (?:the |my |your )?(?:side )?panel\b/i;
// "what are the keyboard shortcuts?"
const SHORTCUTS = /\b(keyboard shortcuts?|shortcut keys?|keyboard commands?|what (?:are the )?(?:keys|shortcuts)|which keys|hot ?keys)\b/i;
// "where am i?": what page this is, read out
const WHERE = /\b(where am i|what page (?:is this|am i on)|describe (?:this|the) page|what site is this)\b/i;
// "what am i looking at?" means the item when an item's page is open, otherwise the page
const LOOKING_AT = /\b(what am i looking at|what(?:'s| is) this)\??[.!]*$/i;
const RESUME = /^(?:okay,?\s*|ok,?\s*)?(resume|continue|go on|keep going|i'?m back|start again|unpause|carry on|let'?s (?:continue|keep going)|where were we)\b/i;
// a question about a number tellr already read off checkout: answer it, don't re-run the review
const MONEY_WORD = /\b(tax|taxes|shipping|delivery|fees?|total|subtotal|cost|costs|charge|charged|price|add-?ons?)\b/i;
const WHY = /\b(why|how come|where (?:did|does|is)|what(?:'s| is) (?:the|that)|is that (?:right|correct)|that (?:seems|looks|sounds)|seems (?:high|wrong|like a lot)|so (?:high|much))\b/i;
// what a sentence is about decides where it goes, before any keyword:
// - a detail of the item (a stain, the soles, the photos, the fabric) makes it a question about
//   the item, even with words like "trust" or "located" in it
// - the item as a whole ("this laptop", "the item") makes "is it reliable?" about the item
// - a named seller or store makes it about the seller
// only after that do listing facts (seller rating, sold count, returns, ships from) apply.
const ITEM_DETAIL = /\b(wear|worn|tears?|rips?|holes?|damaged?|stains?|scuffs?|scratch(?:es|ed)?|marks?|dents?|cracks?|creas(?:e|es|ing)|pilling|fad(?:e|ed|ing)|smell|odou?r|soles?|heels?|toes?|insoles?|laces?|straps?|buckles?|zippers?|buttons?|seams?|lining|fabric|material|colou?r|photos?|pictures?|images?|screen|battery)\b/i;
const ITEM_WHOLE = /\b(item|product)\b|\b(?:this|these|that|those) (?!(?:seller|store|shop|page|listing|site|one|ones|is|was|are|in|on|for|to|with|and|or|a|an|the|legit|legitimate|safe|real|ok|okay|good|fine|worth|right|correct)\b)[a-z]{3,}/i;
const SELLER_NOUN = /\b(sellers?|seller's|store|shop|merchant|vendor)\b/i;
const SELLER_ASK = /\b(rating|ratings|feedback|reviews?|trust|trustworthy|legit|legitimate|reliable|reputation|scam|scammer|good|safe|real|who|about|history|record|stats|sold|sales|joined|responds?|located|from)\b/i;
// trusting the purchase, with nothing else named, is a question about the seller
const TRUST = /\b(trust|trustworthy|legit|legitimate|scam|scammer|reliable|reputation|feedback|uncomfortable|safe to buy|buy (?:this |it )?safely)\b/i;
const POPULAR = /\b(popular|popularity|how many (?:have )?(?:been )?sold|how many (?:people )?(?:are )?watch(?:ing)?|watchers|in (?:\w+ )?carts|bought|in demand|selling fast|how many (?:are )?(?:left|available)|in stock|stock left)\b/i;
const RETURNS = /\b(returns|return policy|can i return|return (?:it|them|this)|return (?:shipping|label|postage|fees?|costs?)|send it back|refunds?)\b/i;
const SHIPS_FROM = /\b(ships? from|shipping from|coming from|located in|where (?:is|are) (?:it|this|they|these|the (?:item|seller|listing|package))(?: \w+){0,2} located|handling time|when (?:will|would) it (?:arrive|come|get here)|how long (?:to|will it take to|until it) (?:ship|arrive))\b/i;
const PAYMENT = /\b(payment options|pay later|afterpay|klarna|financing|pay in installments)\b/i;
const LISTED_CONDITION = /\b(listed condition|stated condition|seller says (?:about )?(?:the )?condition|condition (?:the )?seller (?:says|listed|gave))\b/i;
const SPECIFICS = /\b(item (?:details|specifics)|specs|specifications|details (?:on|in) the listing)\b/i;
// the seller's own words, read as written: the description, or the listing's exact title
const READ_DESCRIPTION = /\b(read (?:me )?(?:the |its |their )?(?:full |whole |item |product |seller'?s? )?description|what does the (?:seller'?s? )?(?:description|listing) say|what did the seller (?:write|say)|the seller'?s (?:own )?words)\b/i;
const READ_TITLE = /\b((?:exact|full|actual|whole|listing'?s?) (?:title|name)|read (?:me )?the (?:title|name)|what(?:'s| is) (?:it|this|the item|the listing) called|what(?:'s| is) the title)\b/i;
// "everything" about the page or listing; "everything about this item" is about the item
const ALL_LISTING = /\b(everything (?:on|in|about) (?:this|the) (?:page|listing)|all the (?:info|information|details)(?: (?:on|in|from) (?:this|the) (?:page|listing))?|what else (?:is on|does) (?:this|the) (?:page|listing)|more (?:info|information|details) (?:on|about|from) (?:this|the) (?:page|listing))\b/i;

// "how much with shipping?" on an item's page: price plus shipping, added up in code
const ALL_IN = /\b(total|all in|altogether|in total|including shipping|with shipping|plus shipping|after shipping|out the door|end up paying)\b/i;
const COST_ASK = /\b(how much|total|cost|price|pay|paying)\b/i;
// shipping or delivery asked about on an item's page: answered from the page's shipping section.
// on a cart or checkout page the same words go to the checkout review instead.
const SHIPPING_TALK = /\b(shipping|ship|ships|shipped|delivery|deliver|delivered|postage|arrive|arrival)\b/i;
const TOTALS = /\b(total|tax|taxes|subtotal|all in|altogether)\b/i;

// asking to hear what other buyers wrote: reviews of the item, or feedback on the seller
// "review" alone is also a verb ("review checkout"), so only the noun forms count
const REVIEWS_ASK = /\b(read (?:me )?(?:a |an |the |some |any |one )?(?:\w+ )?(?:reviews?|feedback|comments?)|reviews|(?:a|the|any|one|some) review|feedback (?:comments?|people|buyers|left)|what (?:do|did|are) (?:people|buyers|customers|others|reviewers) (?:say|said|saying|think)|what (?:people|buyers|customers|others) (?:say|said|think)|anyone (?:say|said|complain))\b/i;
const SELLER_RATING_ONLY = /\b(rating|ratings|percent|positive|score|stars?|how (?:good|reliable|trustworthy))\b/i;

// which group of listing facts a sentence asks for, or null when it's about the item itself
function factTopic(spoken, onItemPage = false) {
  // "read me a review of the seller" wants the buyers' words; "how are the seller's ratings" the numbers
  if (REVIEWS_ASK.test(spoken) && !SELLER_RATING_ONLY.test(spoken)) return SELLER_NOUN.test(spoken) ? "seller-reviews" : "reviews";
  const detail = ITEM_DETAIL.test(spoken);
  if (SELLER_NOUN.test(spoken) && SELLER_ASK.test(spoken) && !detail) return "seller";
  if (TRUST.test(spoken) && !detail && !ITEM_WHOLE.test(spoken)) return "seller";
  if (detail) return null;
  if (POPULAR.test(spoken)) return "popularity";
  if (RETURNS.test(spoken)) return "returns";
  if (SHIPS_FROM.test(spoken)) return "shipping";
  if (onItemPage && SHIPPING_TALK.test(spoken) && !TOTALS.test(spoken)) return "shipping";
  if (PAYMENT.test(spoken)) return "payment";
  if (LISTED_CONDITION.test(spoken)) return "condition";
  if (SPECIFICS.test(spoken)) return "specifics";
  if (ALL_LISTING.test(spoken)) return "all";
  return null;
}
// changing a search filter ("turn off the buy it now filter", "include auctions") is about the
// search, so it's checked before buying: "buy it now" there names a filter, not a purchase
const SEARCH_SETTING = /\b((?:turn (?:on|off)|remove|drop|clear|disable|add|use|apply) (?:the |that )?(?:[a-z]+ ){0,4}filters?|(?:include|allow|show(?: me)?) auctions|cheapest (?:ones? )?first|sort(?:ed)? by price|low(?:est)? to high(?:est)?|(?:used|pre-?owned|secondhand|second hand) (?:is|are) (?:fine|okay|ok|good)|(?:only|just) (?:new|used|brand new)|(?:brand )?new only|used only|no auctions|auctions? (?:are|is) (?:fine|okay|ok)|buy it now only)\b/i;
// wants to buy or get to checkout. tellr only moves to the button; the shopper presses it.
const BUY = /\b(how (?:do|can|would) i (?:buy|purchase|order|check ?out|get (?:it|this|them))|(?:take|bring|get) me to (?:the )?(?:checkout|check out|cart|basket)|go to (?:the )?(?:checkout|check out|cart)|add (?:it|this|them)? ?to (?:my |the )?(?:cart|bag|basket)|(?:i(?:'ll| will| want to| wanna)? )(?:buy|purchase|order) (?:it|this|these|them|that)|buy (?:it|this) now|where(?:'s| is) (?:the )?(?:buy|checkout|cart) button)\b/i;
const BACK_TO_LIST = /\b(go back|back to (?:the )?(?:list|results|options|search|other ones)|(?:the |see the |show me the |hear the )?other (?:options|ones|items|pairs)|see the others|show me the others|the rest of (?:them|the list))\b/i;
// adding a requirement while on an item ("I need them to be leather", "it has to be size 9",
// "actually I want flats"): saved, then this item is checked against it
const WISH = /\b(i (?:need|want|would like|'?d like|prefer|'?d prefer|'?d rather|would rather)|(?:has|have|needs?|need) to be|must be|should be|(?:gotta|got to) be|rather have|instead|actually)\b/i;
// leaving the item for other results, as opposed to changing what's wanted
const LEAVE = /\b(find|search|look for|show me (?:other|more|different)|other (?:ones|options|pairs|items)|something else|different (?:ones?|pair|item)|another (?:one|pair|item)|go back|back to|start over)\b/i;
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

// "check this item", "look at the photos": the full photo check, read out. any other way of
// reaching the check is a question, which gets an answer instead
const INSPECT_COMMAND = /\b(inspect|check (?:this|the|it|that)(?: item| one| listing| pair)?|look (?:closely |closer )?at (?:the )?(?:photos?|pictures?|listing|item|images?)|look closer|examine|analy[sz]e)\b/i;
export function isInspectCommand(text) {
  return INSPECT_COMMAND.test(String(text || "")) && !QUESTION.test(String(text || "").replace(/^(?:can|could) you /i, ""));
}

// "saved 2", "saved number two": a place on the shortlist (1-based), else null
export function parseSavedNumber(text) {
  const match = String(text || "").toLowerCase().match(/\bsaved (?:number |item |one )?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : ORDINAL_WORDS[match[1]];
}

// a question ("does it come with a dust bag?") is about what's open, not a request for a new item.
// "can you find me…" and "do you have…" still ask for one.
const ASKS_FOR_ITEM = /\b(find|search|show me|look(?:ing)? for|shop(?:ping)? for|get me|i (?:want|need)|i'?d like|instead|do you have|got any)\b/i;
export function requestsItem(text) {
  const spoken = String(text || "");
  return !QUESTION.test(spoken) || ASKS_FOR_ITEM.test(spoken);
}

export function classifyIntent(text, session) {
  const spoken = text.trim();
  if (!spoken) return "empty";
  // "pause or close?" waits for one of the two words
  if (session.pendingLeave) {
    if (/\b(pause|later|come back|break)\b/i.test(spoken)) return "pause";
    if (/\b(close|finish(?:ed)?|done|quit|exit|end it|bye|goodbye)\b/i.test(spoken)) return "close";
    if (NO.test(spoken) || /\b(keep going|continue|stay|neither)\b/i.test(spoken)) return "leave-cancel";
  }
  if (isClose(spoken) && !FOR_A_BIT.test(spoken)) return "close";
  if (STATUS.test(spoken)) return "status";
  if (PAUSE.test(spoken)) return "pause";
  if (session.paused && RESUME.test(spoken)) return "resume";
  // "this one doesn't fit. want me to search for ones that do?"
  if (session.pendingSearch) {
    if (YES.test(spoken) || /^(?:please |sure,? )?(?:search|go back|do that)\b/i.test(spoken)) return "search-confirm";
    if (NO.test(spoken) || /\b(stay|keep (?:this|it)|this one is fine)\b/i.test(spoken)) return "search-cancel";
  }
  // "clear all your saved items?"
  if (session.pendingClearSaved) {
    if (YES.test(spoken) || /^(?:please )?clear(?: it| them| all)?\b/i.test(spoken)) return "clear-saved-yes";
    if (NO.test(spoken) || /\bkeep\b/i.test(spoken)) return "clear-saved-no";
  }
  // "before you go, want me to save this one?"
  if (session.pendingSaveOffer) {
    if (YES.test(spoken) || /^(?:please )?save(?: it| this one)?\b/i.test(spoken)) return "save-offer-yes";
    if (NO.test(spoken) || /^(?:no thanks?|skip(?: it)?|don'?t save)\b/i.test(spoken)) return "save-offer-no";
  }
  // a pending demo confirmation only accepts a clear yes or no
  if (session.pendingConfirm) {
    if (NO.test(spoken)) return "cancel-confirm";
    if (YES.test(spoken) || CONFIRM.test(spoken)) return "confirm";
  }
  if (isLeaving(spoken, session)) return "leave";
  if (HELP.test(spoken)) return "help";
  if (SHORTCUTS.test(spoken)) return "shortcuts";
  if (WHERE.test(spoken)) return "where";
  if (LOOKING_AT.test(spoken)) return session.onListing ? (session.report ? "explain" : "inspect") : "where";
  if (REPEAT.test(spoken) || (REPEAT_LOOSE.test(spoken) && spoken.split(/\s+/).length <= 8)) return "repeat";
  if (FORGET_SIZE.test(spoken)) return "forget-size";
  if (WHAT_SIZE.test(spoken)) return "what-size";
  if (RECAP.test(spoken)) return "recap";
  if (PANEL.test(spoken)) return "panel";
  if (PANEL_CLOSE.test(spoken)) return "panel-close";
  // the shortlist, before list, compare, and open: "open saved 2" isn't result number 2
  if (CLEAR_SAVED.test(spoken)) return "clear-saved";
  if (UNSAVE.test(spoken)) return "unsave";
  // a size statement answers tellr only when tellr asked about size; otherwise it's remembered
  if (MY_SIZE.test(spoken) && session.awaiting?.topic !== "size") return "remember-size";
  if (SAVED_WORDS.test(spoken)) {
    if (/\bcompare\b/i.test(spoken)) return "compare-saved";
    if (OPEN_VERB.test(spoken)) return "open-saved";
    // "read my list" reads it; "add it to my list" saves (the noun "list" isn't a request to read)
    if (!SAVE.test(spoken) || /\b(what|read|hear|tell me|go (?:over|through)|list my)\b/i.test(spoken)) return "list-saved";
  }
  if (SAVE.test(spoken)) return "save";
  if (CANCEL.test(bare(spoken))) return "cancel";
  if (CORRECTION.test(bare(spoken))) return "correction";
  if (RESET.test(spoken)) return "reset";
  // tellr just asked something: what comes next is the answer ("8", "for work", "doesn't
  // matter", "just search"), unless it's a command or a question back
  if (
    session.awaiting &&
    !QUESTION.test(spoken) &&
    !parseSiteSearch(spoken) &&
    !BUY.test(spoken) &&
    !MORE.test(spoken) &&
    !LIST.test(spoken) &&
    !(OPEN_VERB.test(spoken) && parseItemNumber(spoken) !== null) &&
    !(session.onListing && BACK_TO_LIST.test(spoken))
  ) {
    // on an item's page, the answer is checked against that item first
    if (session.onListing && session.preferences) return "item-requirement";
    return session.preferences ? "refine" : "requirements";
  }
  // "read more" continues a description that was cut into parts, before "more" means more results
  if (session.descriptionLeft && /^(?:read |say |keep |go |tell me )?(?:more|on|going|the rest)\b/i.test(spoken)) return "read-description-more";
  if (parseSiteSearch(spoken)) return "find";
  if (MORE.test(spoken)) return session.results?.length ? "more" : "list";
  if (LIST.test(spoken)) return "list";
  if (parseCompareList(spoken)?.length > 1) return "compare";
  if (OPEN_VERB.test(spoken) && parseItemNumber(spoken) !== null) return "open";
  if (CONFIRM.test(spoken)) return "confirm";
  if (session.preferences && SEARCH_SETTING.test(spoken)) return "refine";
  if (BUY.test(spoken)) return "buy";
  // on an item: a new requirement is checked against this item before anything else happens
  if (
    session.onListing &&
    session.preferences &&
    !QUESTION.test(spoken) &&
    !LEAVE.test(spoken) &&
    (WISH.test(spoken) || (CONSTRAINT.test(spoken) && !ITEM_TALK.test(spoken)))
  ) {
    return "item-requirement";
  }
  // the listing's own words, on an item's page
  if (session.onListing && READ_TITLE.test(spoken)) return "read-title";
  if (session.onListing && READ_DESCRIPTION.test(spoken)) return "read-description";
  // on an item's page (not the cart or checkout): the all-in price, from the page's own numbers
  if (session.onListing && !session.onCheckout && ALL_IN.test(spoken) && COST_ASK.test(spoken) && !/\b(review|check) (?:the )?(?:checkout|cart|order)\b/i.test(spoken)) {
    return "item-total";
  }
  const fact = factTopic(spoken, session.onListing && !session.onCheckout);
  if (fact) return `facts:${fact}`;
  if (session.checkout && MONEY_WORD.test(spoken) && (WHY.test(spoken) || QUESTION.test(spoken)) && !/\b(review|check) (the )?(checkout|cart|order)\b/i.test(spoken)) {
    return "checkout-question";
  }
  // on a single item's page, questions about it go to that item and never start a new search:
  // inspect it if it hasn't been, otherwise answer from the inspection
  // statements count too ("I want to know about the wear and tear"): only a clear new search
  // ("find…", "show me other…", "actually size 9") leaves the item
  // "which ones…", "the others", "those" point back at the list, not at the open item
  const aboutList = /\b(which ones?|the ones|ones|options|those|the others|others|cheaper|cheapest|number \d+)\b/i.test(spoken);
  // leaving the item for the list: the only way the other options come back, besides a new search
  if (session.onListing && BACK_TO_LIST.test(spoken) && session.results?.length) return "back";
  if (session.onListing && !REVIEW.test(spoken) && ITEM_TALK.test(spoken) && !NEW_SEARCH.test(spoken) && !aboutList) {
    return session.report ? "explain" : "inspect";
  }
  // on an item's page, any other question is about that item: "what are they made of?"
  if (session.onListing && QUESTION.test(spoken) && !REVIEW.test(spoken) && !NEW_SEARCH.test(spoken) && !aboutList) {
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
