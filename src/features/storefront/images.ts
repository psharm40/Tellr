// checks and shrinks uploaded photos in the browser before they become data urls
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGES = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1568;
const MAX_DATA_URL_CHARS = 2_000_000;

export async function photoToDataUrl(file: File): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name} is not a JPEG, PNG, or WebP photo.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than 15 MB. Choose a smaller photo.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} could not be opened as a photo.`);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare photos.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let quality = 0.85;
  let url = canvas.toDataURL("image/jpeg", quality);
  while (url.length > MAX_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.15;
    url = canvas.toDataURL("image/jpeg", quality);
  }
  if (url.length > MAX_DATA_URL_CHARS) throw new Error(`${file.name} is still too large after shrinking.`);
  return url;
}
