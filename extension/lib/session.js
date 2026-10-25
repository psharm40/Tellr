// in-memory shopping session. checkout math still happens on the server.

export function createSession() {
  return {
    pageUrl: null,
    listing: null,
    checkout: null,
    preferences: null,
    clarificationQuestions: [],
    report: null,
    review: null,
    demoOrderId: null,
    history: [],
    lastAnswer: "",
    notice: null,
    busy: false,
    voice: { status: "idle", transcript: "" },
  };
}

export function pushHistory(session, role, text) {
  const clipped = String(text).trim().slice(0, 1000);
  if (!clipped) return session;
  return { ...session, history: [...session.history, { role, text: clipped }].slice(-6) };
}

export function bumpCheckout(session, checkout) {
  const prev = session.checkout;
  if (!checkout) return { ...session, checkout: null, review: null, demoOrderId: null };
  const same =
    prev &&
    prev.listingId === checkout.listingId &&
    prev.quantity === checkout.quantity &&
    prev.unitPriceCents === checkout.unitPriceCents &&
    prev.shippingCents === checkout.shippingCents &&
    prev.taxCents === checkout.taxCents &&
    prev.hasSubscription === checkout.hasSubscription &&
    prev.estimatedDeliveryDate === checkout.estimatedDeliveryDate &&
    JSON.stringify(prev.addOns) === JSON.stringify(checkout.addOns);
  if (same) return { ...session, checkout: prev };
  return {
    ...session,
    checkout: { ...checkout, version: prev ? prev.version + 1 : 1 },
    review: null,
    demoOrderId: null,
  };
}

const TOPIC = [
  ["shoe", /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|sandal|heels|footwear)\b/i],
  ["laptop", /\b(laptop|laptops|notebook|macbook|chromebook|computer)\b/i],
  ["phone", /\b(phone|iphone|android|pixel|smartphone)\b/i],
  ["headphone", /\b(headphone|headphones|earbuds|airpods)\b/i],
  ["tv", /\b(television|\btv\b|monitor)\b/i],
];

export function topicFromText(text) {
  const blob = String(text || "");
  for (const [topic, pattern] of TOPIC) {
    if (pattern.test(blob)) return topic;
  }
  return null;
}

export function forgetStaleGoal(session, page, spoken) {
  const spokenTopic = topicFromText(spoken);
  const prefTopic = topicFromText(session.preferences?.category || "");
  const listingTopic = topicFromText(`${session.listing?.title || ""} ${session.listing?.category || ""}`);
  const pageTopic = topicFromText(
    `${page?.title || ""} ${page?.category || ""} ${(page?.products || []).map((item) => item.title).join(" ")}`,
  );
  const pageChanged =
    session.pageUrl &&
    page?.url &&
    (() => {
      try {
        return new URL(session.pageUrl).pathname !== new URL(page.url).pathname;
      } catch {
        return session.pageUrl !== page.url;
      }
    })();
  const conflict =
    (spokenTopic && prefTopic && spokenTopic !== prefTopic) ||
    (pageTopic && prefTopic && pageTopic !== prefTopic) ||
    (spokenTopic && listingTopic && spokenTopic !== listingTopic);
  if (!conflict && !pageChanged) return { ...session, pageUrl: page?.url || session.pageUrl };
  return {
    ...session,
    pageUrl: page?.url || session.pageUrl,
    listing: pageChanged || conflict ? null : session.listing,
    preferences: conflict ? null : session.preferences,
    clarificationQuestions: conflict ? [] : session.clarificationQuestions,
    report: pageChanged || conflict ? null : session.report,
    review: null,
    demoOrderId: null,
    checkout: pageChanged || conflict ? null : session.checkout,
    history: conflict ? [] : session.history,
  };
}

export function titlesMatch(a, b) {
  const clean = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}
