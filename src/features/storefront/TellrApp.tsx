"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { CheckoutSnapshot } from "@/types/tellr";
import { AccessibleStatus, ErrorNotice, Spinner } from "@/components/AccessibleStatus";
import { CheckoutEditor } from "@/components/CheckoutEditor";
import { CheckoutReviewView, DemoConfirmation } from "@/components/CheckoutReviewView";
import { InspectionReportView, inspectionSpeech } from "@/components/InspectionReportView";
import { ListingCard } from "@/components/ListingCard";
import { ListingSelector } from "@/components/ListingSelector";
import { PreferencesView, RequirementsForm } from "@/components/RequirementsForm";
import { STEP_STATE, StepSection, type StepState } from "@/components/StepSection";
import { ApiError, confirmDemoOrder, inspectListing, parseRequirements, reviewCheckout } from "./api";
import { OVERALL, budgetText, clipForSpeech, formatUsd, preferencesSpeech } from "./format";
import { createInitialState, reviewIsCurrent, selectedListing, sessionReducer, type AppState } from "./session";
import { VoiceAssistant, type SpeechRequest } from "./voice";

type Task = "requirements" | "inspection" | "review" | "confirm";
type TaskError = { message: string; status: number; retry: () => void };

const IDLE: Record<Task, boolean> = { requirements: false, inspection: false, review: false, confirm: false };

// ?fixtures=1 turns on labeled development fixtures for routes that have not merged yet
function useFixtureMode(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("fixtures") === "1",
    () => false,
  );
}

export function TellrApp() {
  const fixtureMode = useFixtureMode();
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialState);
  const [requirementsText, setRequirementsText] = useState("");
  const [speechRequest, setSpeechRequest] = useState<SpeechRequest | null>(null);
  const [busy, setBusy] = useState(IDLE);
  const [errors, setErrors] = useState<Partial<Record<Task, TaskError>>>({});
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef<AppState>(state);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const orderHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  const { session } = state;
  const listing = selectedListing(state);
  const review = session.checkoutReview;
  const currentReview = reviewIsCurrent(state);

  function announce(message: string) {
    // a trailing space makes screen readers repeat an identical message
    setAnnouncement((previous) => (previous === message ? `${message} ` : message));
  }

  function speak(text: string) {
    setSpeechRequest({ id: crypto.randomUUID(), text: clipForSpeech(text) });
  }

  function focusSoon(ref: React.RefObject<HTMLHeadingElement | null>) {
    requestAnimationFrame(() => ref.current?.focus());
  }

  async function run<T>(task: Task, work: () => Promise<T>, retry: () => void): Promise<T | null> {
    setBusy((current) => ({ ...current, [task]: true }));
    setErrors((current) => ({ ...current, [task]: undefined }));
    try {
      return await work();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [task]: {
          message: error instanceof Error ? error.message : "Something went wrong. Try again.",
          status: error instanceof ApiError ? error.status : 0,
          retry,
        },
      }));
      return null;
    } finally {
      setBusy((current) => ({ ...current, [task]: false }));
    }
  }

  // typed and spoken requirements both come through here
  async function submitRequirements(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setRequirementsText(text);
    announce("Understanding your request.");
    const result = await run("requirements", () => parseRequirements(trimmed, fixtureMode), () => void submitRequirements(text));
    if (!result) return;
    const { preferences, clarificationQuestions } = result.data;
    dispatch({ type: "preferences_loaded", preferences, clarificationQuestions, source: result.source });
    announce(
      `Requirements updated: ${preferences.requirements.length} found. ${clarificationQuestions.length ? "Tellr has a question for you." : ""}`,
    );
    speak(`${result.source === "fixture" ? "Development fixture. " : ""}${preferencesSpeech(preferences, clarificationQuestions)}`);
  }

  async function inspect() {
    if (!listing || !state.preferencesReady) return;
    if (!listing.images.length) {
      setErrors((current) => ({
        ...current,
        inspection: { message: "Add at least one seller photo before inspecting.", status: 0, retry: () => undefined },
      }));
      return;
    }
    const preferencesRevision = state.preferencesRevision;
    const listingRevision = state.listingRevision;
    const preferences = session.preferences;
    announce("Inspecting the photos. This can take a few seconds.");
    const result = await run("inspection", () => inspectListing(listing, preferences, fixtureMode), () => void inspect());
    if (!result) return;
    if (latest.current.preferencesRevision !== preferencesRevision || latest.current.listingRevision !== listingRevision) {
      announce("The listing or requirements changed while inspecting. Inspect again for an up to date report.");
      return;
    }
    const { report } = result.data;
    dispatch({ type: "inspection_loaded", report, source: result.source, preferencesRevision, listingRevision });
    const flagged = report.assessments.filter((assessment) => assessment.status !== "supported").length;
    announce(`Inspection report ready. ${flagged} of ${report.assessments.length} requirements need attention.`);
    speak(inspectionSpeech(report, preferences, result.source === "fixture"));
    focusSoon(reportHeading);
  }

  async function runReview() {
    const checkout = session.checkout;
    const selectedId = session.selectedListingId;
    if (!checkout || !selectedId || !state.preferencesReady) return;
    const preferencesRevision = state.preferencesRevision;
    announce("Reviewing the checkout.");
    const result = await run(
      "review",
      () => reviewCheckout(session.preferences, checkout, selectedId, fixtureMode),
      () => void runReview(),
    );
    if (!result) return;
    if (
      latest.current.session.checkout?.version !== checkout.version ||
      latest.current.preferencesRevision !== preferencesRevision
    ) {
      announce("The checkout changed while it was being reviewed. Review it again.");
      return;
    }
    const { review: next } = result.data;
    dispatch({ type: "review_loaded", review: next, source: result.source, preferencesRevision });
    const total = next.totalCents === null ? "Total not yet known." : `Total ${formatUsd(next.totalCents)}.`;
    announce(`Checkout review: ${OVERALL[next.overall].label} ${total}`);
    speak(`${result.source === "fixture" ? "Development fixture. " : ""}${next.spokenSummary}`);
    focusSoon(reviewHeading);
  }

  async function confirm() {
    const checkout = session.checkout;
    const selectedId = session.selectedListingId;
    if (!checkout || !selectedId || !review || !currentReview || review.overall !== "pass") return;
    announce("Confirming the demo order.");
    const result = await run(
      "confirm",
      () => confirmDemoOrder(session.preferences, checkout, selectedId, review.checkoutVersion),
      () => void confirm(),
    );
    if (!result) return;
    dispatch({ type: "order_confirmed", demoOrderId: result.demoOrderId, version: checkout.version });
    announce(`Demo order placed. Order number ${result.demoOrderId}. Nothing was bought.`);
    speak("Demo order placed. This was a simulation, so nothing was bought and no payment was taken.");
    focusSoon(orderHeading);
  }

  function editCheckout(patch: Partial<CheckoutSnapshot>, message: string) {
    const version = (session.checkout?.version ?? 0) + 1;
    dispatch({ type: "edit_checkout", patch });
    setErrors((current) => ({ ...current, review: undefined, confirm: undefined }));
    announce(`${message} Checkout version ${version} needs a new review.`);
  }

  const routeHint = (task: Task) =>
    errors[task]?.status === 404 && !fixtureMode
      ? "This step's server route comes from a teammate's branch that has not merged yet. Developers can add ?fixtures=1 to the address to use labeled sample data."
      : undefined;

  const step1: { state: StepState; summary: string } = !state.preferencesReady
    ? { state: "ready", summary: "Describe the laptop you want and your budget, by typing or speaking." }
    : state.clarificationQuestions.length
      ? { state: "attention", summary: "Tellr has a question about your requirements." }
      : {
          state: "done",
          summary: `${session.preferences.requirements.length} requirements. ${budgetText(session.preferences)}.`,
        };

  const flagged = session.inspectionReport?.assessments.filter((item) => item.status !== "supported").length ?? 0;
  const step2: { state: StepState; summary: string } = !state.preferencesReady
    ? { state: "waiting", summary: "Finish step 1 first." }
    : session.inspectionReport
      ? flagged
        ? { state: "attention", summary: `Inspection done. ${flagged} requirements are not confirmed by the evidence.` }
        : { state: "done", summary: "Inspection done. Every requirement is supported by evidence." }
      : !listing?.images.length
        ? { state: "attention", summary: "Add 1 to 3 seller photos, then inspect." }
        : { state: "ready", summary: `Ready to inspect ${listing.images.length} photos.` };

  const step3: { state: StepState; summary: string } = !state.preferencesReady
    ? { state: "waiting", summary: "Finish step 1 first." }
    : review && currentReview
      ? review.overall === "pass"
        ? { state: "done", summary: "The checkout passed review." }
        : { state: "attention", summary: OVERALL[review.overall].label }
      : { state: "ready", summary: "Check the simulated checkout before confirming." };

  const step4: { state: StepState; summary: string } = state.demoOrderId
    ? { state: "done", summary: "Demo order placed. Nothing was bought." }
    : review && currentReview && review.overall === "pass"
      ? { state: "ready", summary: "Confirm the demo order." }
      : { state: "waiting", summary: "Unlocks after the checkout passes review." };

  const steps = [
    { number: 1, title: "Tell us what matters", ...step1 },
    { number: 2, title: "Inspect the used item", ...step2 },
    { number: 3, title: "Check checkout", ...step3 },
    { number: 4, title: "Review & confirm demo order", ...step4 },
  ];

  const inspectBlocker = !state.preferencesReady
    ? "Finish step 1 first."
    : !listing?.images.length
      ? "Add at least one seller photo first."
      : "";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Tellr</h1>
        <p className="mt-2 text-xl">Check a used laptop before you buy it, by voice or keyboard.</p>
        <p className="tellr-hint mt-1">Demo only: Tellr never makes real purchases or asks for payment details.</p>
        {fixtureMode && (
          <p className="tellr-badge-fixture mt-3">
            DEVELOPMENT FIXTURE MODE is on. Steps whose server route is missing use sample data, and each of those
            results is labeled.
          </p>
        )}
      </header>

      <nav aria-label="Steps" className="tellr-card">
        <h2 className="sr-only">Your progress</h2>
        <ol className="grid gap-2 sm:grid-cols-2">
          {steps.map((step) => (
            <li key={step.number}>
              <a href={`#step-${step.number}`} className="tellr-step-link">
                <span className="font-semibold">
                  {step.number}. {step.title}
                </span>
                <span className="tellr-hint block">
                  <span aria-hidden="true">{STEP_STATE[step.state].icon} </span>
                  {STEP_STATE[step.state].label}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <VoiceAssistant
        onTranscript={submitRequirements}
        speechRequest={speechRequest}
        disabled={busy.requirements}
      />

      {state.notice && (
        <div role="status" className="tellr-callout tellr-tone-info">
          <p>{state.notice}</p>
          <button type="button" className="tellr-btn tellr-btn-small mt-2" onClick={() => dispatch({ type: "clear_notice" })}>
            Dismiss
          </button>
        </div>
      )}

      <StepSection {...steps[0]}>
        <RequirementsForm
          text={requirementsText}
          onTextChange={setRequirementsText}
          onSubmit={(text) => void submitRequirements(text)}
          busy={busy.requirements}
        />
        {errors.requirements && (
          <ErrorNotice
            message={errors.requirements.message}
            onRetry={errors.requirements.retry}
            hint={routeHint("requirements")}
          />
        )}
        {state.preferencesReady && (
          <>
            {state.preferencesSource === "fixture" && (
              <p className="tellr-badge-fixture mt-4">
                DEVELOPMENT FIXTURE: these requirements are sample data, not parsed from your text
              </p>
            )}
            <PreferencesView preferences={session.preferences} questions={state.clarificationQuestions} />
            <button
              type="button"
              className="tellr-btn mt-4"
              onClick={() => speak(preferencesSpeech(session.preferences, state.clarificationQuestions))}
            >
              Read requirements aloud
            </button>
          </>
        )}
      </StepSection>

      <StepSection {...steps[1]}>
        <ListingSelector
          listings={state.listings}
          selectedId={session.selectedListingId}
          onSelect={(listingId) => {
            dispatch({ type: "select_listing", listingId });
            announce("Listing selected. Its checkout was reset.");
          }}
        />
        {listing && (
          <ListingCard
            listing={listing}
            onAnnounce={announce}
            onDescriptionChange={(description) => {
              dispatch({ type: "edit_description", listingId: listing.id, description });
              announce("Description updated.");
            }}
            onAddPhotos={(urls) => dispatch({ type: "add_photos", listingId: listing.id, urls })}
            onRemovePhoto={(imageId) => dispatch({ type: "remove_photo", listingId: listing.id, imageId })}
          />
        )}
        <div className="mt-4">
          <button
            type="button"
            className="tellr-btn-primary"
            onClick={() => void inspect()}
            disabled={busy.inspection || Boolean(inspectBlocker)}
            aria-describedby={inspectBlocker ? "inspect-blocker" : undefined}
          >
            {busy.inspection ? (
              <Spinner label="Inspecting photos…" />
            ) : session.inspectionReport ? (
              "Inspect again"
            ) : (
              "Inspect this listing"
            )}
          </button>
          {inspectBlocker && (
            <p id="inspect-blocker" className="tellr-hint mt-2">
              {inspectBlocker}
            </p>
          )}
        </div>
        {errors.inspection && (
          <ErrorNotice
            message={errors.inspection.message}
            onRetry={errors.inspection.status ? errors.inspection.retry : undefined}
            hint={routeHint("inspection")}
          />
        )}
        {session.inspectionReport && listing && (
          <InspectionReportView
            ref={reportHeading}
            report={session.inspectionReport}
            preferences={session.preferences}
            listing={listing}
            fixture={state.inspectionSource === "fixture"}
            onReadAloud={() =>
              speak(inspectionSpeech(session.inspectionReport!, session.preferences, state.inspectionSource === "fixture"))
            }
          />
        )}
      </StepSection>

      <StepSection {...steps[2]}>
        {session.checkout && <CheckoutEditor checkout={session.checkout} listing={listing} onChange={editCheckout} />}
        <div className="mt-5">
          <button
            type="button"
            className="tellr-btn-primary"
            onClick={() => void runReview()}
            disabled={busy.review || !state.preferencesReady}
            aria-describedby={!state.preferencesReady ? "review-blocker" : undefined}
          >
            {busy.review ? <Spinner label="Reviewing checkout…" /> : "Review checkout"}
          </button>
          {!state.preferencesReady && (
            <p id="review-blocker" className="tellr-hint mt-2">
              Finish step 1 first, so Tellr knows your budget and requirements.
            </p>
          )}
        </div>
        {errors.review && (
          <ErrorNotice message={errors.review.message} onRetry={errors.review.retry} hint={routeHint("review")} />
        )}
        {review && currentReview && (
          <CheckoutReviewView
            ref={reviewHeading}
            review={review}
            fixture={state.reviewSource === "fixture"}
            onReadAloud={() => speak(review.spokenSummary)}
          />
        )}
      </StepSection>

      <StepSection {...steps[3]}>
        <DemoConfirmation
          ref={orderHeading}
          review={review}
          reviewIsCurrent={currentReview}
          demoOrderId={state.demoOrderId}
          busy={busy.confirm}
          onConfirm={() => void confirm()}
        />
        {errors.confirm && (
          <ErrorNotice message={errors.confirm.message} onRetry={errors.confirm.retry} hint={routeHint("confirm")} />
        )}
      </StepSection>

      <AccessibleStatus message={announcement} />
    </main>
  );
}
