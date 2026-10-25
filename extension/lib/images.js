// fetch page photos in the service worker (host permissions, no cors) and
// turn them into jpeg data urls the inspection route will accept.
// matches the server's limit in src/features/inspection/imageValidation.ts
const MAX_IMAGES = 8;
const MAX_BYTES = 5 * 1024 * 1024;

function bytesToDataUrl(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// marketplaces serve small thumbnails; ask for the full-size photo so small defects are visible
export function fullSizeUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)ebayimg\.com$/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/s-l\d+(\.\w+)$/i, "/s-l1600$1");
      return u.href;
    }
    if (/(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$/i.test(u.hostname)) {
      // "81abc._AC_UL320_.jpg" -> "81abc.jpg"
      u.pathname = u.pathname.replace(/\._[^/]*?_\.(jpe?g|png|webp)$/i, ".$1");
      return u.href;
    }
  } catch {
    // not a url we can rewrite
  }
  return url;
}

// thumbnails for "which one did they mean": small and fast, not inspection quality
const THUMB = { maxEdge: 320, minEdge: 60, fullSize: false, qualities: [0.7, 0.55] };
// 8 photos at ~450 kb each stay well under vercel's 4.5 mb request limit
const PHOTO = { maxEdge: 1280, minEdge: 160, fullSize: true, qualities: [0.82, 0.7, 0.55, 0.4], maxBytes: 450 * 1024 };

async function toJpeg(url, opts = PHOTO) {
  const wanted = opts.fullSize ? fullSizeUrl(url) : url;
  let response = await fetch(wanted, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
  // fall back to the original if the full-size version isn't there
  if (!response?.ok && wanted !== url) response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response) return null;
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
  if (longest < opts.minEdge) {
    bitmap.close();
    return null;
  }

  const scale = Math.min(1, opts.maxEdge / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of opts.qualities) {
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (jpeg.size <= (opts.maxBytes ?? MAX_BYTES)) {
      return bytesToDataUrl(new Uint8Array(await jpeg.arrayBuffer()));
    }
  }
  return null;
}

export async function listingImagesFromUrls(candidates) {
  // fetch a few spare ones at once, in case some fail, then keep the page's order
  const tries = candidates
    .map((candidate) => ({ href: typeof candidate === "string" ? candidate : candidate.url, alt: typeof candidate === "string" ? "" : candidate.alt }))
    .filter(({ href }) => href && /^https?:\/\//i.test(href))
    .slice(0, MAX_IMAGES + 4);
  const converted = await Promise.all(tries.map(({ href }) => toJpeg(href).catch(() => null)));
  const images = [];
  converted.forEach((dataUrl, i) => {
    if (!dataUrl || images.length >= MAX_IMAGES) return;
    images.push({ id: `img_${images.length + 1}`, url: dataUrl, alt: tries[i].alt || `Product photo ${images.length + 1}` });
  });
  return images;
}

// small data-url thumbnails, keyed by result number; missing or broken ones are skipped
const thumbCache = new Map();
export async function thumbnailFor(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (thumbCache.has(url)) return thumbCache.get(url);
  const dataUrl = await toJpeg(url, THUMB).catch(() => null);
  if (thumbCache.size > 200) thumbCache.clear();
  thumbCache.set(url, dataUrl);
  return dataUrl;
}
