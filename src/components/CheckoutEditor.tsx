"use client";

import { useId, useState } from "react";
import type { CheckoutSnapshot, Listing } from "@/types/tellr";
import { centsToInput, formatUsd, parseDollarsToCents } from "@/features/storefront/format";

type Patch = Partial<Omit<CheckoutSnapshot, "id" | "version" | "listingId" | "currency">>;

const DEMO_ADDON_ID = "addon_protection_plan";

// typed money that only saves once it is a valid amount, on blur or enter
function MoneyField({
  label,
  value,
  allowUnknown,
  onCommit,
}: {
  label: string;
  value: number | null;
  allowUnknown?: boolean;
  onCommit: (cents: number | null) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const unknown = value === null;
  const commit = (text: string) => {
    const cents = parseDollarsToCents(text);
    if (cents === null) {
      setError(`Enter ${label.toLowerCase()} as dollars, like 15.00.`);
      return;
    }
    setError("");
    if (cents !== value) onCommit(cents);
  };
  return (
    <div>
      <label htmlFor={id} className="tellr-label">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="relative">
          <span aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2">
            $
          </span>
          <input
            key={value ?? "unknown"}
            id={id}
            inputMode="decimal"
            className="tellr-input w-36 pl-7"
            defaultValue={unknown ? "" : centsToInput(value)}
            disabled={unknown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(event.currentTarget.value);
              }
            }}
          />
        </span>
        {allowUnknown && (
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-blue-800"
              checked={unknown}
              onChange={(event) => {
                setError("");
                onCommit(event.target.checked ? null : 0);
              }}
            />
            Not shown yet
          </label>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="tellr-error-text mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckoutEditor({
  checkout,
  listing,
  onChange,
}: {
  checkout: CheckoutSnapshot;
  listing: Listing | null;
  onChange: (patch: Patch, announcement: string) => void;
}) {
  const quantityId = useId();
  const subscriptionId = useId();
  const deliveryId = useId();
  const hasDemoAddOn = checkout.addOns.some((addOn) => addOn.id === DEMO_ADDON_ID);

  return (
    <div>
      <p className="tellr-hint">
        This is a simulated checkout. Change anything to see how Tellr reacts. Every change makes a new checkout
        version that needs a new review.
      </p>
      <dl className="tellr-facts mt-3">
        <div>
          <dt>Item</dt>
          <dd>{listing?.title ?? checkout.listingId}</dd>
        </div>
        <div>
          <dt>Checkout version</dt>
          <dd>{checkout.version}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={quantityId} className="tellr-label">
            Quantity
          </label>
          <input
            id={quantityId}
            type="number"
            min={1}
            step={1}
            className="tellr-input mt-1 w-28"
            value={checkout.quantity}
            onChange={(event) => {
              const quantity = Number(event.target.value);
              if (Number.isInteger(quantity) && quantity >= 1) onChange({ quantity }, `Quantity set to ${quantity}.`);
            }}
          />
        </div>
        <MoneyField
          label="Item price"
          value={checkout.unitPriceCents}
          onCommit={(cents) => onChange({ unitPriceCents: cents ?? 0 }, "Item price changed.")}
        />
        <MoneyField
          label="Shipping"
          value={checkout.shippingCents}
          allowUnknown
          onCommit={(cents) => onChange({ shippingCents: cents }, cents === null ? "Shipping marked not shown." : "Shipping changed.")}
        />
        <MoneyField
          label="Tax"
          value={checkout.taxCents}
          allowUnknown
          onCommit={(cents) => onChange({ taxCents: cents }, cents === null ? "Tax marked not shown." : "Tax changed.")}
        />
        <div>
          <label htmlFor={subscriptionId} className="tellr-label">
            Subscription
          </label>
          <select
            id={subscriptionId}
            className="tellr-input mt-1"
            value={checkout.hasSubscription === null ? "unknown" : checkout.hasSubscription ? "yes" : "no"}
            onChange={(event) => {
              const value = event.target.value;
              const hasSubscription = value === "unknown" ? null : value === "yes";
              onChange({ hasSubscription }, `Subscription set to ${event.target.selectedOptions[0]?.text ?? value}.`);
            }}
          >
            <option value="no">No subscription</option>
            <option value="yes">Includes a subscription</option>
            <option value="unknown">Not stated</option>
          </select>
        </div>
        <div>
          <label htmlFor={deliveryId} className="tellr-label">
            Estimated delivery
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <input
              id={deliveryId}
              type="date"
              className="tellr-input w-48"
              value={checkout.estimatedDeliveryDate ?? ""}
              disabled={checkout.estimatedDeliveryDate === null}
              onChange={(event) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
                  onChange({ estimatedDeliveryDate: event.target.value }, `Delivery date set to ${event.target.value}.`);
                }
              }}
            />
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-blue-800"
                checked={checkout.estimatedDeliveryDate === null}
                onChange={(event) =>
                  onChange(
                    { estimatedDeliveryDate: event.target.checked ? null : "2026-10-30" },
                    event.target.checked ? "Delivery date marked not shown." : "Delivery date set to 2026-10-30.",
                  )
                }
              />
              Not shown yet
            </label>
          </div>
        </div>
      </div>

      <h3 className="tellr-label mt-5">Add-ons</h3>
      {checkout.addOns.length === 0 ? (
        <p className="tellr-hint">No add-ons.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {checkout.addOns.map((addOn) => (
            <li key={addOn.id} className="tellr-row">
              <span>
                <span className="font-semibold">{addOn.label}</span> {formatUsd(addOn.priceCents)}
              </span>
              <span className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5 accent-blue-800"
                    checked={addOn.explicitlyAccepted}
                    onChange={(event) =>
                      onChange(
                        {
                          addOns: checkout.addOns.map((item) =>
                            item.id === addOn.id ? { ...item, explicitlyAccepted: event.target.checked } : item,
                          ),
                        },
                        `${addOn.label} ${event.target.checked ? "accepted" : "not accepted"}.`,
                      )
                    }
                  />
                  I want this
                </label>
                <button
                  type="button"
                  className="tellr-btn tellr-btn-small"
                  aria-label={`Remove ${addOn.label}`}
                  onClick={() =>
                    onChange(
                      { addOns: checkout.addOns.filter((item) => item.id !== addOn.id) },
                      `${addOn.label} removed.`,
                    )
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="tellr-callout tellr-tone-info mt-5">
        <h3 className="font-bold">Try a surprise at checkout</h3>
        <p className="tellr-hint">These buttons copy common checkout tricks so you can hear Tellr catch them.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="tellr-btn"
            disabled={hasDemoAddOn}
            onClick={() =>
              onChange(
                {
                  addOns: [
                    ...checkout.addOns,
                    { id: DEMO_ADDON_ID, label: "Protection plan", priceCents: 900, explicitlyAccepted: false },
                  ],
                },
                "A $9.00 protection plan you did not ask for was added.",
              )
            }
          >
            Add a $9 protection plan I didn&apos;t ask for
          </button>
          <button
            type="button"
            className="tellr-btn"
            onClick={() =>
              onChange(
                { shippingCents: (checkout.shippingCents ?? 0) + 1500 },
                "Shipping went up by $15.00.",
              )
            }
          >
            Raise shipping by $15
          </button>
        </div>
      </div>
    </div>
  );
}
