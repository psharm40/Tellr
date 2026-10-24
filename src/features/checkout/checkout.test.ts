// run with: node src/features/checkout/scripts/run-tests.mjs
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { confirmDemoOrder } from "./confirmDemoOrder";
import { CHECKOUT_RULE_IDS, computeTotalCents, evaluateCheckout } from "./evaluateCheckout";
import {
  OTHER_LISTING_ID,
  SELECTED_LISTING_ID,
  baseCheckout,
  basePreferences,
  checkoutFixtures,
} from "./fixtures";
import { formatCents } from "./money";
import { validateConfirmRequest, validateReviewRequest } from "./validate";

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

describe("item_match", () => {
  test("match passes", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout, SELECTED_LISTING_ID);
    assert.equal(review.checks[0].status, "pass");
    assert.equal(review.overall, "pass");
  });

  test("mismatch fails and blocks", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout, OTHER_LISTING_ID);
    assert.equal(review.checks[0].status, "fail");
    assert.equal(review.overall, "blocked");
  });

  test("missing is unknown and critical, so overall is needs_review", () => {
    const review = evaluateCheckout(basePreferences, baseCheckout);
    assert.equal(review.checks[0].status, "unknown");
    assert.equal(review.overall, "needs_review");
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
  test("is deterministic and mentions the problem", () => {
    const checkout = { ...baseCheckout, version: 2, hasSubscription: true };
    const a = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    const b = evaluateCheckout(basePreferences, checkout, SELECTED_LISTING_ID).spokenSummary;
    assert.equal(a, b);
    assert.match(a, /^Checkout is blocked\./);
    assert.match(a, /subscription/);
  });
});

describe("validation", () => {
  const body = { preferences: basePreferences, checkout: baseCheckout, selectedListingId: SELECTED_LISTING_ID };

  test("accepts a valid review request", () => {
    assert.equal(validateReviewRequest(body).ok, true);
  });

  test("selectedListingId is optional; null is treated as missing", () => {
    const absent = validateReviewRequest({ preferences: basePreferences, checkout: baseCheckout });
    const asNull = validateReviewRequest({ ...body, selectedListingId: null });
    assert.ok(absent.ok && absent.value.selectedListingId === undefined);
    assert.ok(asNull.ok && asNull.value.selectedListingId === undefined);
  });

  test("rejects an empty or non-string selectedListingId", () => {
    assert.equal(validateReviewRequest({ ...body, selectedListingId: "" }).ok, false);
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

  test("refuses when selectedListingId is missing", () => {
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
