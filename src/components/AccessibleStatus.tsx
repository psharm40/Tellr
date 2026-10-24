"use client";

import type { ReactNode } from "react";

// one polite live region for progress and results. errors use ErrorNotice instead.
export function AccessibleStatus({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
  retryLabel = "Try again",
  hint,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  hint?: ReactNode;
}) {
  return (
    <div role="alert" className="tellr-callout tellr-tone-bad mt-3">
      <p className="font-semibold">
        <span aria-hidden="true">✕ </span>
        {message}
      </p>
      {hint && <p className="tellr-hint mt-1">{hint}</p>}
      {onRetry && (
        <button type="button" className="tellr-btn mt-3" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="tellr-spinner" />
      {label}
    </span>
  );
}

export function StatusPill({ icon, label, tone }: { icon: string; label: string; tone: string }) {
  return (
    <span className={`tellr-pill tellr-tone-${tone}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

export function FixtureBadge({ what }: { what: string }) {
  return <p className="tellr-badge-fixture">DEVELOPMENT FIXTURE: {what} is sample data, not a real result</p>;
}
