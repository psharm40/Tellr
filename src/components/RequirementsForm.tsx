"use client";

import { useId } from "react";
import type { ShoppingPreferences } from "@/types/tellr";
import { budgetText, describeRequirement, priorityLabel } from "@/features/storefront/format";
import { Spinner } from "./AccessibleStatus";

export function RequirementsForm({
  text,
  onTextChange,
  onSubmit,
  busy,
}: {
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: (text: string) => void;
  busy: boolean;
}) {
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text);
      }}
    >
      <label htmlFor={id} className="tellr-label">
        What do you need? Type it or say it.
      </label>
      <p id={`${id}-hint`} className="tellr-hint">
        For example: I need a used laptop under $300, no cracked screen, and a charger.
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        className="tellr-input mt-2 min-h-28"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit(text);
          }
        }}
      />
      <button type="submit" className="tellr-btn-primary mt-3" disabled={busy || !text.trim()}>
        {busy ? <Spinner label="Understanding your request…" /> : "Understand my requirements"}
      </button>
    </form>
  );
}

export function PreferencesView({
  preferences,
  questions,
}: {
  preferences: ShoppingPreferences;
  questions: string[];
}) {
  return (
    <div className="mt-5">
      <h3 className="text-xl font-bold">What Tellr understood</h3>
      <dl className="tellr-facts mt-2">
        <div>
          <dt>Looking for</dt>
          <dd>{preferences.category || "Not stated"}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{budgetText(preferences)}</dd>
        </div>
      </dl>
      {preferences.requirements.length ? (
        <ul className="mt-3 space-y-2">
          {preferences.requirements.map((requirement) => (
            <li key={requirement.id} className="tellr-row">
              <span>{describeRequirement(requirement)}</span>
              <span className="tellr-hint">{priorityLabel(requirement)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tellr-hint mt-2">No specific requirements were found. Add details and try again.</p>
      )}
      {questions.length > 0 && (
        <div className="tellr-callout tellr-tone-warn mt-4">
          <h4 className="font-bold">
            <span aria-hidden="true">? </span>Tellr needs to check
          </h4>
          <ul className="mt-1 list-disc pl-6">
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <p className="tellr-hint mt-2">Edit your text above to answer, then submit again.</p>
        </div>
      )}
    </div>
  );
}
