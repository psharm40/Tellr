// keyword routing only. the model is never asked to classify intent.
const CONFIRM = /\b(confirm( the)?( demo)?( order)?|place the demo|yes,? confirm|go ahead and confirm)\b/i;
const REVIEW = /\b(check( out)? the (cart|order|fees|total|checkout)|review (the )?(cart|order|fees|total|checkout)|checkout|shipping|tax|what('s| is) (the )?total)\b/i;
const PAGE = /\b(cheapest|lowest( priced)?|most expensive|highest( priced)?|how much|what('s| is) the (cheapest|lowest|price)|prices? on (this|the) page|on (this|the) page|these (shoes|items)|this page|what (shoes|items)|tell me about (this|these))\b/i;
const INSPECT = /\b(inspect|check (this|the|it|that)|look at (the )?(photo|picture|listing|item)|flaw|crack|scratch|condition|what('s| is) wrong|is (it|this) (ok|okay|safe|fine))\b/i;
const REQUIRE = /\b(i (want|need|am looking|'m looking)|looking for|find me|budget|under \$?\d|no more than|must (have|be)|required|i('m| am) shopping)\b/i;
const RESET = /\b(start over|never mind|forget that|not a laptop|not what i (want|need|asked)|that'?s not what i|wrong item)\b/i;

export function classifyIntent(text, session) {
  const spoken = text.trim();
  if (!spoken) return "empty";
  if (RESET.test(spoken)) return "reset";
  if (CONFIRM.test(spoken)) return "confirm";
  if (REVIEW.test(spoken)) return "review";
  if (PAGE.test(spoken)) return "page";
  if (INSPECT.test(spoken)) return "inspect";
  if (REQUIRE.test(spoken) || !session.preferences) return "requirements";
  if (session.report) return "explain";
  return "page";
}
