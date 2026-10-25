// validates and decodes listing images for multimodal analysis. only inline
// base64 data urls are accepted — arbitrary http(s) urls are rejected rather than
// fetched (no server-side fetch of user-supplied urls, avoiding ssrf). pure and
// testable: returns a result object rather than throwing or calling any api.

import type { ListingImage } from "@/types/tellr";

// media types we pass to the model (claude image blocks). gif is intentionally
// excluded for this laptop-photo use case.
export type SupportedMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ValidatedImage {
  id: string;
  mediaType: SupportedMediaType;
  data: string; // base64 payload, without the data-url prefix
}

export type ImageValidationResult =
  | { ok: true; images: ValidatedImage[] }
  | { ok: false; message: string };

export const MIN_IMAGES = 1;
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image (decoded)
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB total (decoded)

// data:image/(jpeg|png|webp);base64,<payload>
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

// decoded byte length of a base64 payload, without allocating a buffer.
function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// validates a listing's images and returns decoded, model-ready image blocks, or a
// plain-language reason the images were rejected.
export function validateListingImages(
  images: ListingImage[],
): ImageValidationResult {
  if (!Array.isArray(images) || images.length < MIN_IMAGES) {
    return { ok: false, message: "at least one listing image is required." };
  }
  if (images.length > MAX_IMAGES) {
    return { ok: false, message: `at most ${MAX_IMAGES} images are supported.` };
  }

  const validated: ValidatedImage[] = [];
  let totalBytes = 0;

  for (const image of images) {
    const match = DATA_URL_RE.exec(image.url.trim());
    if (!match) {
      // reject non-data urls (incl. http/https) instead of fetching them (ssrf-safe).
      return {
        ok: false,
        message:
          "images must be provided as base64 data urls (jpeg, png, or webp). remote urls are not fetched.",
      };
    }

    const mediaType = match[1] as SupportedMediaType;
    const data = match[2];
    const bytes = decodedByteLength(data);

    if (bytes === 0) {
      return { ok: false, message: "an image contained no data." };
    }
    if (bytes > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        message: `each image must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`,
      };
    }

    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        message: `total image size must be ${MAX_TOTAL_BYTES / (1024 * 1024)} MB or smaller.`,
      };
    }

    validated.push({ id: image.id, mediaType, data });
  }

  return { ok: true, images: validated };
}
