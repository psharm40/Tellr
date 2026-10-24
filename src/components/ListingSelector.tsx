"use client";

import type { Listing } from "@/types/tellr";
import { formatUsd } from "@/features/storefront/format";

export function ListingSelector({
  listings,
  selectedId,
  onSelect,
}: {
  listings: Listing[];
  selectedId: string | null;
  onSelect: (listingId: string) => void;
}) {
  return (
    <fieldset>
      <legend className="tellr-label">Choose a listing (fictional demo listings)</legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {listings.map((listing) => (
          <label key={listing.id} className="tellr-choice">
            <input
              type="radio"
              name="listing"
              value={listing.id}
              checked={listing.id === selectedId}
              onChange={() => onSelect(listing.id)}
              className="mt-1 size-5 accent-blue-800"
            />
            <span>
              <span className="block font-semibold">{listing.title}</span>
              <span className="block">{formatUsd(listing.itemPriceCents)} item price</span>
              <span className="tellr-hint block">
                {listing.images.length} {listing.images.length === 1 ? "photo" : "photos"}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
