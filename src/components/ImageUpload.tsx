"use client";

/* eslint-disable @next/next/no-img-element -- photos are local data urls, not optimizable assets */
import { useId, useRef, useState } from "react";
import type { ListingImage } from "@/types/tellr";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGES, photoToDataUrl } from "@/features/storefront/images";
import { Spinner } from "./AccessibleStatus";

export function ImageUpload({
  images,
  onAdd,
  onRemove,
  onAnnounce,
}: {
  images: ListingImage[];
  onAdd: (urls: string[]) => void;
  onRemove: (imageId: string) => void;
  onAnnounce: (message: string) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const room = MAX_IMAGES - images.length;

  async function handleFiles(files: File[]) {
    setErrors([]);
    if (!files.length) return;
    const problems: string[] = [];
    if (files.length > room) {
      problems.push(`Only ${room} more ${room === 1 ? "photo fits" : "photos fit"}. The extra photos were skipped.`);
    }
    setBusy(true);
    const urls: string[] = [];
    for (const file of files.slice(0, room)) {
      try {
        urls.push(await photoToDataUrl(file));
      } catch (error) {
        problems.push(error instanceof Error ? error.message : `${file.name} could not be added.`);
      }
    }
    setBusy(false);
    setErrors(problems);
    if (urls.length) {
      onAdd(urls);
      onAnnounce(`${urls.length} ${urls.length === 1 ? "photo" : "photos"} added.`);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <h4 className="tellr-label">Seller photos</h4>
      <p id={`${id}-hint`} className="tellr-hint">
        Add 1 to {MAX_IMAGES} photos of the laptop: JPEG, PNG, or WebP. Tellr checks only what the photos actually show.
      </p>
      {images.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <li key={image.id} className="tellr-photo">
              <img src={image.url} alt={image.alt} className="aspect-[4/3] w-full rounded-md object-cover" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold">{image.id}</span>
                <button
                  type="button"
                  className="tellr-btn tellr-btn-small"
                  onClick={() => {
                    onRemove(image.id);
                    onAnnounce(`${image.id} removed.`);
                  }}
                  aria-label={`Remove ${image.id}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          className="peer sr-only"
          aria-describedby={`${id}-hint`}
          disabled={busy || room <= 0}
          onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
        />
        <label htmlFor={id} className={`tellr-btn tellr-file-trigger ${busy || room <= 0 ? "tellr-btn-disabled" : ""}`}>
          {busy ? (
            <Spinner label="Preparing photos…" />
          ) : room <= 0 ? (
            `${MAX_IMAGES} photos added (remove one to add another)`
          ) : (
            "Add photos"
          )}
        </label>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="tellr-callout tellr-tone-bad mt-3 list-disc pl-8">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
