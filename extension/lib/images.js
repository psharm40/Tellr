// fetch page photos in the service worker (host permissions, no cors) and
// turn them into jpeg data urls the inspection route will accept.
const MAX_IMAGES = 3;
const MAX_EDGE = 1568;
const MAX_BYTES = 5 * 1024 * 1024;

function bytesToDataUrl(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

async function toJpeg(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return null;
  const blob = await response.blob();
  const type = blob.type || "";
  if (type && !type.startsWith("image/")) return null;
  if (type.includes("svg") || type.includes("gif") || type.includes("icon")) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest < 160) {
    bitmap.close();
    return null;
  }

  const scale = Math.min(1, MAX_EDGE / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.82, 0.7, 0.55]) {
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (jpeg.size <= MAX_BYTES) {
      return bytesToDataUrl(new Uint8Array(await jpeg.arrayBuffer()));
    }
  }
  return null;
}

export async function listingImagesFromUrls(candidates) {
  const images = [];
  for (const candidate of candidates) {
    if (images.length >= MAX_IMAGES) break;
    const href = typeof candidate === "string" ? candidate : candidate.url;
    if (!href || !/^https?:\/\//i.test(href)) continue;
    try {
      const dataUrl = await toJpeg(href);
      if (!dataUrl) continue;
      images.push({
        id: `img_${images.length + 1}`,
        url: dataUrl,
        alt: (typeof candidate === "string" ? "" : candidate.alt) || `Product photo ${images.length + 1}`,
      });
    } catch {
      // skip photos we cannot fetch or convert
    }
  }
  return images;
}
