"use client";

/* eslint-disable @next/next/no-img-element -- photos are local data urls, not optimizable assets */
import { forwardRef } from "react";
import type { Evidence, InspectionReport, Listing, ShoppingPreferences } from "@/types/tellr";
import { EVIDENCE_STATUS, describeRequirement } from "@/features/storefront/format";
import { FixtureBadge, StatusPill } from "./AccessibleStatus";

const SOURCE_LABEL: Record<Evidence["sourceType"], string> = {
  photo: "Photo evidence",
  description: "Seller's claim in the description",
  seller_response: "Seller's reply",
};

function EvidenceItem({ evidence, listing }: { evidence: Evidence; listing: Listing }) {
  const image = evidence.sourceType === "photo" ? listing.images.find((item) => item.id === evidence.sourceId) : undefined;
  return (
    <li className="flex items-start gap-3">
      {image && <img src={image.url} alt="" className="mt-1 size-14 shrink-0 rounded object-cover" />}
      <span>
        <span className="block font-semibold">
          {SOURCE_LABEL[evidence.sourceType]}
          {evidence.sourceType === "photo" && <span className="font-mono"> ({evidence.sourceId})</span>}
        </span>
        <span className="block">{evidence.observation}</span>
      </span>
    </li>
  );
}

export const InspectionReportView = forwardRef<
  HTMLHeadingElement,
  {
    report: InspectionReport;
    preferences: ShoppingPreferences;
    listing: Listing;
    fixture: boolean;
    onReadAloud: () => void;
  }
>(function InspectionReportView({ report, preferences, listing, fixture, onReadAloud }, headingRef) {
  const evidenceById = new Map(report.evidence.map((item) => [item.id, item]));
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          Inspection report
        </h3>
        <button type="button" className="tellr-btn" onClick={onReadAloud}>
          Read report aloud
        </button>
      </div>
      {fixture && <FixtureBadge what="this inspection" />}
      <p className="tellr-hint mt-1">
        Photos can show visible wear. They cannot prove the laptop works, has a healthy battery, or has no hidden
        damage.
      </p>

      <ul className="mt-4 space-y-4">
        {report.assessments.map((assessment) => {
          const requirement = preferences.requirements.find((item) => item.id === assessment.requirementId);
          const status = EVIDENCE_STATUS[assessment.status];
          return (
            <li key={assessment.requirementId} className={`tellr-subcard tellr-edge-${status.tone}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-lg font-bold">
                  {requirement ? describeRequirement(requirement) : assessment.requirementId}
                </h4>
                <StatusPill {...status} />
              </div>
              <p className="mt-2">{assessment.explanation}</p>
              {assessment.evidenceIds.length > 0 && (
                <>
                  <p className="tellr-label mt-3">Based on</p>
                  <ul className="mt-1 space-y-2">
                    {assessment.evidenceIds.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId);
                      return evidence ? (
                        <EvidenceItem key={evidenceId} evidence={evidence} listing={listing} />
                      ) : (
                        <li key={evidenceId} className="tellr-hint">
                          Evidence {evidenceId} is missing from the report.
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {assessment.followUpQuestion && (
                <p className="mt-3">
                  <span className="font-semibold">Ask the seller: </span>
                  {assessment.followUpQuestion}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {report.sellerQuestions.length > 0 && (
        <div className="tellr-callout tellr-tone-info mt-4">
          <h4 className="font-bold">Questions to ask the seller</h4>
          <ul className="mt-1 list-disc pl-6">
            {report.sellerQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-4">
        <summary className="tellr-summary">All evidence ({report.evidence.length})</summary>
        <ul className="mt-2 space-y-2">
          {report.evidence.map((evidence) => (
            <EvidenceItem key={evidence.id} evidence={evidence} listing={listing} />
          ))}
        </ul>
      </details>
    </div>
  );
});

export function inspectionSpeech(report: InspectionReport, preferences: ShoppingPreferences, fixture: boolean): string {
  const parts: string[] = [];
  if (fixture) parts.push("Development fixture. This is not a real inspection.");
  for (const assessment of report.assessments) {
    const requirement = preferences.requirements.find((item) => item.id === assessment.requirementId);
    const label = requirement ? describeRequirement(requirement) : assessment.requirementId;
    parts.push(`${label}. ${EVIDENCE_STATUS[assessment.status].label}. ${assessment.explanation}`);
  }
  if (report.sellerQuestions.length) parts.push(`Questions for the seller: ${report.sellerQuestions.join(" ")}`);
  return parts.join(" ");
}
