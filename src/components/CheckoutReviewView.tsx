"use client";

import { forwardRef, useId, useState } from "react";
import type { CheckoutReview } from "@/types/tellr";
import { CHECK_STATUS, OVERALL, formatUsd, ruleLabel } from "@/features/storefront/format";
import { FixtureBadge, Spinner, StatusPill } from "./AccessibleStatus";

const ORDER = { fail: 0, unknown: 1, pass: 2 } as const;

export const CheckoutReviewView = forwardRef<
  HTMLHeadingElement,
  { review: CheckoutReview; fixture: boolean; onReadAloud: () => void }
>(function CheckoutReviewView({ review, fixture, onReadAloud }, headingRef) {
  const overall = OVERALL[review.overall];
  const checks = [...review.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          Checkout review (version {review.checkoutVersion})
        </h3>
        <button type="button" className="tellr-btn" onClick={onReadAloud}>
          Read review aloud
        </button>
      </div>
      {fixture && <FixtureBadge what="this checkout review" />}
      <div className={`tellr-callout tellr-tone-${overall.tone} mt-3`}>
        <p className="text-lg font-bold">
          <span aria-hidden="true">{overall.icon} </span>
          {overall.label}
        </p>
        <p className="mt-1 text-lg">
          Total: <span className="font-bold">{review.totalCents === null ? "not yet known" : formatUsd(review.totalCents)}</span>
        </p>
      </div>
      <ul className="mt-4 space-y-2">
        {checks.map((check) => (
          <li key={check.ruleId} className={`tellr-subcard tellr-edge-${CHECK_STATUS[check.status].tone}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold">{ruleLabel(check.ruleId)}</h4>
              <StatusPill {...CHECK_STATUS[check.status]} />
            </div>
            <p className="mt-1">{check.explanation}</p>
          </li>
        ))}
      </ul>
      <details className="mt-4">
        <summary className="tellr-summary">Spoken summary text</summary>
        <p className="mt-2">{review.spokenSummary}</p>
      </details>
    </div>
  );
});

export const DemoConfirmation = forwardRef<
  HTMLHeadingElement,
  {
    review: CheckoutReview | null;
    reviewIsCurrent: boolean;
    demoOrderId: string | null;
    busy: boolean;
    onConfirm: () => void;
  }
>(function DemoConfirmation({ review, reviewIsCurrent, demoOrderId, busy, onConfirm }, headingRef) {
  const id = useId();
  const [consent, setConsent] = useState<{ version: number; checked: boolean } | null>(null);
  const ready = Boolean(review && reviewIsCurrent && review.overall === "pass");
  // consent only counts for the exact checkout version it was given for
  const agreed = Boolean(ready && review && consent?.checked && consent.version === review.checkoutVersion);

  if (demoOrderId) {
    return (
      <div className="tellr-callout tellr-tone-good">
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          <span aria-hidden="true">✓ </span>Demo order placed
        </h3>
        <p className="mt-1">
          Demo order number <span className="font-mono font-semibold">{demoOrderId}</span>. This was a simulation:
          nothing was bought and no payment was taken.
        </p>
      </div>
    );
  }

  if (!ready || !review) {
    return (
      <p className="tellr-hint">
        {review && !reviewIsCurrent
          ? "The checkout changed after the last review. Review it again in step 3."
          : review
            ? "Confirming is locked until the checkout review passes. Fix the problems in step 3 first."
            : "Review the checkout in step 3 first. Confirming unlocks only after it passes."}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (agreed) onConfirm();
      }}
    >
      <p>
        You reviewed checkout version {review.checkoutVersion}. Total:{" "}
        <span className="font-bold">{review.totalCents === null ? "not yet known" : formatUsd(review.totalCents)}</span>.
      </p>
      <label htmlFor={id} className="mt-3 flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-blue-800"
          checked={agreed}
          onChange={(event) => setConsent({ version: review.checkoutVersion, checked: event.target.checked })}
        />
        <span>
          I reviewed this checkout and want to place a <strong>demo</strong> order. I understand no real purchase or
          payment happens.
        </span>
      </label>
      <button type="submit" className="tellr-btn-primary mt-4" disabled={!agreed || busy}>
        {busy ? <Spinner label="Confirming demo order…" /> : "Confirm demo order"}
      </button>
    </form>
  );
});
