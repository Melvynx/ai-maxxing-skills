/**
 * Images pasted or dropped in the composer, made light in the browser before they leave: at most 1600 px on the long
 * side (JPEG 0.85 unless the original is already small enough), plus a 512 px thumbnail the history keeps.
 */

export const MAX_IMAGES = 4;
const MAX_SIDE = 1600;
const THUMB_SIDE = 512;
const KEEP_BYTES = 1_200_000;
const MAX_BYTES = 2_800_000;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type Attachment = { id: string; data: string; thumb: string; name: string };

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function draw(bitmap: ImageBitmap, side: number, quality: number): Promise<string> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  // JPEG has no transparency: a white page under it, like a screenshot.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export class ImageError extends Error {}

export async function prepareImage(file: File): Promise<Attachment> {
  if (!ACCEPTED.includes(file.type)) throw new ImageError(`"${file.name}" is not a PNG, JPEG, WebP or GIF image.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError(`Could not read "${file.name}".`);
  }
  try {
    const small = file.size <= KEEP_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_SIDE;
    const data = small ? await readAsDataUrl(file) : await draw(bitmap, MAX_SIDE, 0.85);
    if (data.length * 0.75 > MAX_BYTES) throw new ImageError(`"${file.name}" is still too heavy after shrinking.`);
    const thumb = await draw(bitmap, THUMB_SIDE, 0.8);
    return { id: crypto.randomUUID(), data, thumb, name: file.name || "image" };
  } finally {
    bitmap.close();
  }
}

/** Images among pasted or dropped files. */
export const imageFiles = (list: FileList | null | undefined) => Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
