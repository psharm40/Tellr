"use client";

import { useId } from "react";
import type { Listing } from "@/types/tellr";
import { formatUsd } from "@/features/storefront/format";
import { ImageUpload } from "./ImageUpload";

export function ListingCard({
  listing,
  onDescriptionChange,
  onAddPhotos,
  onRemovePhoto,
  onAnnounce,
}: {
  listing: Listing;
  onDescriptionChange: (description: string) => void;
  onAddPhotos: (urls: string[]) => void;
  onRemovePhoto: (imageId: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const id = useId();
  return (
    <div className="tellr-subcard mt-4">
      <h3 className="text-xl font-bold">{listing.title}</h3>
      <p>
        {formatUsd(listing.itemPriceCents)} item price. Tax and shipping are checked in step 3.
      </p>
      <label htmlFor={id} className="tellr-label mt-4 block">
        Seller&apos;s description (written by the seller, not verified)
      </label>
      <textarea
        // remount when the saved text changes so the box always shows what will be inspected
        key={listing.description}
        id={id}
        className="tellr-input mt-1 min-h-24"
        defaultValue={listing.description}
        onBlur={(event) => {
          if (event.target.value !== listing.description) onDescriptionChange(event.target.value);
        }}
      />
      <div className="mt-4">
        <ImageUpload images={listing.images} onAdd={onAddPhotos} onRemove={onRemovePhoto} onAnnounce={onAnnounce} />
      </div>
    </div>
  );
}
