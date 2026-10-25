// run with: node src/features/checkout/scripts/run-tests.mjs
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { confirmDemoOrder } from "./confirmDemoOrder";
import { CHECKOUT_RULE_IDS, computeTotalCents, evaluateCheckout, spokenDate } from "./evaluateCheckout";
import {
  OTHER_LISTING_ID,
  SELECTED_LISTING_ID,
  baseCheckout,
  basePreferences,
  checkoutFixtures,
} from "./fixtures";
import { formatCents } from "./money";
import { MISSING_SELECTED_LISTING_ERROR, validateConfirmRequest, validateReviewRequest } from "./validate";

describe("evaluateCheckout fixtures", () => {
  for (const f of checkoutFixtures) {
    test(f.name, () => {
      const review = evaluateCheckout(f.preferences, f.checkout, f.selectedListingId);
      assert.equal(review.overall, f.expected.overall);
      assert.equal(review.totalCents, f.expected.totalCents);
      assert.equal(review.checkoutId, f.checkout.id);
      assert.equal(review.checkoutVersion, f.checkout.version);
      assert.deepEqual(
        review.checks.map((c) => c.ruleId),
        [...CHECKOUT_RULE_IDS],
      );
      for (const c of review.checks) {
        const expected = f.expected.checks[c.ruleId as keyof typeof f.expected.checks] ?? "pass";
        assert.equal(c.status, expected, `${c.ruleId}: ${c.explanation}`);
        assert.ok(c.explanation.length > 0);
      }
    });
  }
});

const itemMatch = (review: ReturnType<typeof evaluateCheckout>) =>
  review.checks.find((c) => c.ruleId === "item_match")?.status;

describe("item_match", () => {
  test("match passes", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout, SELECTED_LISTING_ID);
    assert.equal(itemMatch(review), "pass");
    assert.equal(review.overall, "pass");
  });

  test("mismatch fails and blocks", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout, OTHER_LISTING_ID);
    assert.equal(itemMatch(review), "fail");
    assert.equal(review.overall, "blocked");
  });

  test("missing (direct call) is unknown and critical, so overall is needs_review", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout);
    assert.equal(itemMatch(review), "unknown");
    assert.equal(review.overall, "needs_review");
  });
});

describe("spokenDate", () => {
  test("reads iso dates with weekday, month name, day and year", () => {
    assert.equal(spokenDate("2026-10-29"), "Thursday, October 29, 2026");
    assert.equal(spokenDate("2026-11-01"), "Sunday, November 1, 2026");
    assert.equal(spokenDate("2028-02-29"), "Tuesday, February 29, 2028");
    assert.equal(spokenDate("2027-01-01"), "Friday, January 1, 2027");
    assert.equal(spokenDate("2026-12-31"), "Thursday, December 31, 2026");
  });

  test("uses utc, so midnight never shifts the day in any timezone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Los_Angeles", "Asia/Kolkata"]) {
        process.env.TZ = tz;
        assert.equal(spokenDate("2026-10-29"), "Thursday, October 29, 2026", tz);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("money", () => {
  test("total is exact integer cents", () => {
    assert.equal(computeTotalCents(baseCheckout), 28563);
    assert.ok(Number.isInteger(computeTotalCents(baseCheckout)));
  });

  test("total is null while shipping is unknown", () => {
    assert.equal(computeTotalCents({ ...baseCheckout, shippingCents: null }), null);
  });

  test("formatting is stable", () => {
    assert.equal(formatCents(28563), "$285.63");
    assert.equal(formatCents(123456789), "$1,234,567.89");
    assert.equal(formatCents(5), "$0.05");
  });
});

describe("spoken summary", () => {
  test("reads every term of a passing checkout in a fixed order", () => {
    const summary = evaluateCheckout(basePreferences, baseCheckout, SELECTED_LISTING_ID).spokenSummary;
    assert.equal(
      summary,
      "Checkout review passed. Quantity: 1. Item subtotal: $250.00. Add-ons: none. Shipping: $15.00. Tax: $20.63. " +
        "Total: $285.63. Subscription: none. Estimated delivery: Thursday, October 29, 2026. " +
        "Everything matches your requirements. Say confirm to place the demo order.",
    );
  });

  test("names each add-on with its price and acceptance, and explains an unknown total", () => {
    const checkout = {
      ...baseCheckout,
      version: 2,
      quantity: 2,
      taxCents: null,
      hasSubscription: null,
      estimatedDeliveryDate: null,
      addOns: [
        { id: "addon_case", label: "laptop sleeve", priceCents: 1200, explicitlyAccepted: true },
        { id: "addon_protection", label: "protection plan", priceCents: 900, explicitlyAccepted: false },
      ],
    };
    const summary = evaluateCheckout({ ...basePreferences, maxTotalCents: 60000 }, checkout, SELECTED_LISTING_ID)
      .spokenSummary;
    assert.ok(
      summary.startsWith(
        "Checkout is blocked: 1 problem, and 4 things are unknown. Quantity: 2. Item subtotal: $500.00 ($250.00 each). " +
          "Add-on: laptop sleeve, $12.00, accepted by you. Add-on: protection plan, $9.00, not accepted by you. " +
          "Shipping: $15.00. Tax: not shown. Total: unknown, because tax is not shown. " +
          "Subscription: unknown. Estimated delivery: not shown. Problems: ",
      ),
      summary,
    );
    // problems come before unknowns, each listed as now
    const problems = summary.indexOf("Problems: ");
    const unknowns = summary.indexOf("Still unknown: ");
    assert.ok(problems > 0 && unknowns > problems);
    assert.match(summary, /Problems: Extras you did not accept were added: protection plan \(\$9\.00\)\./);
    assert.match(summary, /Still unknown: The final total is unknown because tax is not shown yet/);
  });

  test("explains when both shipping and tax are missing", () => {
    const checkout = { ...baseCheckout, version: 2, shippingCents: null, taxCents: null };
    const summary = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    assert.match(summary, /Shipping: not shown\. Tax: not shown\. Total: unknown, because shipping and tax are not shown\./);
  });

  test("states an included subscription", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true };
    const summary = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    assert.match(summary, /^Checkout is blocked: 1 problem\./);
    assert.match(summary, /Subscription: included\./);
    assert.match(summary, /Problems: This checkout includes a subscription\./);
  });

  test("counts problems when blocked", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true, shippingCents: 4500 };
    const summary = evaluateCheckout(basePreferences, checkout, OTHER_LISTING_ID).spokenSummary;
    // total_budget, item_match and subscription fail; nothing is unknown, so no unknowns part
    assert.match(summary, /^Checkout is blocked: 3 problems\. Quantity:/);
  });

  test("blocked with one problem and one unknown uses singular for both", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true, estimatedDeliveryDate: null };
    const summary = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    // subscription fails; delivery is unknown
    assert.match(summary, /^Checkout is blocked: 1 problem, and 1 thing is unknown\. Quantity:/);
  });

  test("blocked with several problems and unknowns uses plural for both", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true, taxCents: null };
    const summary = evaluateCheckout(basePreferences, checkout, OTHER_LISTING_ID).spokenSummary;
    // item_match and subscription fail; total_budget and price_breakdown are unknown
    assert.match(summary, /^Checkout is blocked: 2 problems, and 2 things are unknown\. Quantity:/);
  });

  test("blocked with no unknowns leaves out the unknowns part", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true };
    const summary = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    assert.match(summary, /^Checkout is blocked: 1 problem\. Quantity:/);
    assert.doesNotMatch(summary.split(" Quantity:")[0], /unknown/);
  });

  test("counts unknowns when needing review", () => {
    const one = evaluateCheckout(basePreferences, { ...baseCheckout, version: 2, hasSubscription: null }, SELECTED_LISTING_ID);
    assert.match(one.spokenSummary, /^Checkout needs review: 1 thing is unknown\. /);
    const several = evaluateCheckout(
      basePreferences,
      { ...baseCheckout, version: 2, taxCents: null, estimatedDeliveryDate: null },
      SELECTED_LISTING_ID,
    );
    // total_budget, delivery and price_breakdown are unknown
    assert.match(several.spokenSummary, /^Checkout needs review: 3 things are unknown\. /);
  });

  test("speaks delivery dates in every delivery explanation", () => {
    const late = evaluateCheckout(basePreferences, { ...baseCheckout, version: 2, estimatedDeliveryDate: "2026-11-05" }, SELECTED_LISTING_ID);
    assert.match(late.spokenSummary, /Estimated delivery: Thursday, November 5, 2026\./);
    assert.match(
      late.spokenSummary,
      /Problems: Estimated delivery on Thursday, November 5, 2026 is after your Sunday, November 1, 2026 deadline\./,
    );
    const missing = evaluateCheckout(basePreferences, { ...baseCheckout, version: 2, estimatedDeliveryDate: null }, SELECTED_LISTING_ID);
    assert.match(missing.spokenSummary, /delivery by Sunday, November 1, 2026 cannot be confirmed/);
    const onTime = evaluateCheckout(basePreferences, baseCheckout, SELECTED_LISTING_ID).checks.find((c) => c.ruleId === "delivery");
    assert.equal(onTime?.explanation, "estimated delivery on Thursday, October 29, 2026 meets your Sunday, November 1, 2026 deadline.");
    const noDeadline = evaluateCheckout({ ...basePreferences, requirements: [] }, baseCheckout, SELECTED_LISTING_ID).checks.find(
      (c) => c.ruleId === "delivery",
    );
    assert.equal(noDeadline?.explanation, "you did not set a delivery deadline; estimated delivery is Thursday, October 29, 2026.");
    // no raw iso date is ever spoken
    for (const review of [late, missing]) assert.doesNotMatch(review.spokenSummary, /\d{4}-\d{2}-\d{2}/);
  });

  test("always discloses the quantity", () => {
    const prefs = { ...basePreferences, maxTotalCents: 60000 };
    const summary = evaluateCheckout(prefs, { ...baseCheckout, quantity: 2 }, SELECTED_LISTING_ID).spokenSummary;
    assert.match(summary, /Quantity: 2\./);
  });

  test("is deterministic", () => {
    for (const f of checkoutFixtures) {
      const a = evaluateCheckout(f.preferences, f.checkout, f.selectedListingId).spokenSummary;
      const b = evaluateCheckout(structuredClone(f.preferences), structuredClone(f.checkout), f.selectedListingId)
        .spokenSummary;
      assert.equal(a, b, f.name);
    }
  });
});

describe("validation", () => {
  const body = { preferences: basePreferences, checkout: baseCheckout, selectedListingId: SELECTED_LISTING_ID };

  test("accepts a valid review request", () => {
    assert.equal(validateReviewRequest(body).ok, true);
  });

  test("selectedListingId is required: missing, null or blank is rejected in plain language", () => {
    for (const selectedListingId of [undefined, null, "", "   "]) {
      const result = validateReviewRequest({ ...body, selectedListingId });
      assert.ok(!result.ok && result.error === MISSING_SELECTED_LISTING_ERROR);
    }
  });

  test("rejects a non-string selectedListingId", () => {
    assert.equal(validateReviewRequest({ ...body, selectedListingId: 42 }).ok, false);
  });

  test("rejects fractional or negative cents", () => {
    assert.equal(validateReviewRequest({ ...body, checkout: { ...baseCheckout, taxCents: 20.5 } }).ok, false);
    assert.equal(validateReviewRequest({ ...body, checkout: { ...baseCheckout, unitPriceCents: -1 } }).ok, false);
    assert.equal(
      validateReviewRequest({ ...body, preferences: { ...basePreferences, maxTotalCents: 300.5 } }).ok,
      false,
    );
  });

  test("rejects an invalid delivery date", () => {
    assert.equal(
      validateReviewRequest({ ...body, checkout: { ...baseCheckout, estimatedDeliveryDate: "2026-02-30" } }).ok,
      false,
    );
  });

  test("confirm requires explicitConsent to be exactly true", () => {
    assert.equal(validateConfirmRequest({ ...body, reviewedVersion: 1, explicitConsent: "yes" }).ok, false);
    assert.equal(validateConfirmRequest({ ...body, reviewedVersion: 1 }).ok, false);
    assert.equal(validateConfirmRequest({ ...body, reviewedVersion: 1, explicitConsent: true }).ok, true);
  });
});

describe("confirmDemoOrder", () => {
  const fixedId = () => "demo_test";
  const confirm = { preferences: basePreferences, explicitConsent: true as const };

  test("confirms a passing, current checkout as a demo order", () => {
    const result = confirmDemoOrder(
      { ...confirm, checkout: baseCheckout, selectedListingId: SELECTED_LISTING_ID, reviewedVersion: 1 },
      fixedId,
    );
    assert.ok(result.ok);
    assert.equal(result.demoOrderId, "demo_test");
    assert.equal(result.status, "demo_completed");
  });

  test("changed checkout after confirmation needs a new review", () => {
    const first = confirmDemoOrder(
      { ...confirm, checkout: baseCheckout, selectedListingId: SELECTED_LISTING_ID, reviewedVersion: 1 },
      fixedId,
    );
    assert.ok(first.ok);
    const v2 = { ...baseCheckout, version: 2, shippingCents: 1900 };
    const second = confirmDemoOrder(
      { ...confirm, checkout: v2, selectedListingId: SELECTED_LISTING_ID, reviewedVersion: 1 },
      fixedId,
    );
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.httpStatus === 409 && /review it again/.test(second.error));
  });

  test("refuses an item mismatch", () => {
    const result = confirmDemoOrder(
      { ...confirm, checkout: baseCheckout, selectedListingId: OTHER_LISTING_ID, reviewedVersion: 1 },
      fixedId,
    );
    assert.ok(!result.ok && result.review.overall === "blocked");
  });

  test("refuses when selectedListingId is missing (direct call)", () => {
    const result = confirmDemoOrder({ ...confirm, checkout: baseCheckout, reviewedVersion: 1 }, fixedId);
    assert.ok(!result.ok && result.review.overall === "needs_review");
  });

  test("refuses when tax is unknown", () => {
    const result = confirmDemoOrder(
      {
        ...confirm,
        checkout: { ...baseCheckout, taxCents: null },
        selectedListingId: SELECTED_LISTING_ID,
        reviewedVersion: 1,
      },
      fixedId,
    );
    assert.ok(!result.ok && result.review.totalCents === null);
  });
});
