import type { ReactNode } from "react";

export type StepState = "done" | "attention" | "waiting" | "ready";

export const STEP_STATE: Record<StepState, { icon: string; label: string; tone: string }> = {
  done: { icon: "✓", label: "Done", tone: "good" },
  attention: { icon: "!", label: "Needs attention", tone: "warn" },
  ready: { icon: "→", label: "Ready", tone: "info" },
  waiting: { icon: "…", label: "Not yet", tone: "muted" },
};

export function StepSection({
  number,
  title,
  state,
  summary,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  summary: string;
  children: ReactNode;
}) {
  const info = STEP_STATE[state];
  return (
    <section id={`step-${number}`} aria-labelledby={`step-${number}-title`} className="tellr-card scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center">
          <span className="tellr-step-number" aria-hidden="true">
            {number}
          </span>
          <h2 id={`step-${number}-title`} className="text-2xl font-bold">
            <span className="sr-only">Step {number} of 4: </span>
            {title}
          </h2>
        </div>
        <p className={`tellr-pill tellr-tone-${info.tone}`}>
          <span aria-hidden="true">{info.icon}</span>
          {info.label}
        </p>
      </div>
      <p className="tellr-hint mt-1">{summary}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
