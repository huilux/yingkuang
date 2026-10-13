import type { PhotoAsset, PhotoCrop, Rect } from "./types";

type CropPhoto = Pick<PhotoAsset, "width" | "height" | "crop">;
export type CropHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeRotation(value: number): number {
  const angle = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round(angle * 1000000) / 1000000;
}

/** Largest centered rectangle contained in the rotated original; no empty corners. */
export function rotationDimensions(width: number, height: number, rotation = 0): { width: number; height: number } {
  const angle = normalizeRotation(rotation);
  const quarter = Math.round(angle / 90);
  const fine = Math.abs(angle - quarter * 90) * Math.PI / 180;
  const w = Math.abs(quarter % 2) === 1 ? height : width;
  const h = Math.abs(quarter % 2) === 1 ? width : height;
  if (fine < 1e-10) return { width: w, height: h };
  const sin = Math.sin(fine), cos = Math.cos(fine);
  const shorter = Math.min(w, h), longer = Math.max(w, h);
  let rw: number, rh: number;
  if (shorter <= 2 * sin * cos * longer || Math.abs(sin - cos) < 1e-10) {
    rw = shorter / 2 / (w >= h ? sin : cos);
    rh = shorter / 2 / (w >= h ? cos : sin);
  } else {
    const cos2 = cos * cos - sin * sin;
    rw = (w * cos - h * sin) / cos2;
    rh = (h * cos - w * sin) / cos2;
  }
  return { width: Math.max(1, Math.floor(rw + 1e-9)), height: Math.max(1, Math.floor(rh + 1e-9)) };
}

export function isValidPhotoCrop(value: unknown): value is PhotoCrop {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as PhotoCrop;
  return [c.x, c.y, c.width, c.height].every(v => typeof v === "number" && Number.isFinite(v))
    && c.x >= 0 && c.y >= 0 && c.width > 0 && c.height > 0
    && (c.rotation === undefined || (typeof c.rotation === "number" && Number.isFinite(c.rotation) && Math.abs(c.rotation) <= 180))
    && c.x + c.width <= 1 + 1e-9 && c.y + c.height <= 1 + 1e-9;
}

/** Round both edges to the nearest original pixel, retaining at least one pixel. */
export function cropPixels(photo: CropPhoto): Rect {
  const { width, height } = rotationDimensions(photo.width, photo.height, photo.crop?.rotation);
  if (!photo.crop) return { x: 0, y: 0, width, height };
  const c = photo.crop;
  const x = clamp(Math.round(c.x * width), 0, width - 1);
  const y = clamp(Math.round(c.y * height), 0, height - 1);
  const right = clamp(Math.round((c.x + c.width) * width), x + 1, width);
  const bottom = clamp(Math.round((c.y + c.height) * height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

export function normalizedCrop(rect: Rect, photo: Pick<PhotoAsset, "width" | "height">, rotation = 0): PhotoCrop | undefined {
  const angle = normalizeRotation(rotation);
  const bounds = rotationDimensions(photo.width, photo.height, angle);
  if (!angle && rect.x === 0 && rect.y === 0 && rect.width === bounds.width && rect.height === bounds.height) return undefined;
  return { x: rect.x / bounds.width, y: rect.y / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height,
    ...(angle ? { rotation: angle } : {}) };
}

export function turnCrop(rect: Rect, bounds: { width: number; height: number }, clockwise: boolean): Rect {
  return clockwise ? { x: bounds.height - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width }
    : { x: rect.y, y: bounds.width - rect.x - rect.width, width: rect.height, height: rect.width };
}

/** Map a stationary editing frame into the rotated safe rectangle, keeping its aspect. */
export function rotationFrameMapping(frame: { width: number; height: number }, rotated: { width: number; height: number }) {
  const scale = Math.min(rotated.width / frame.width, rotated.height / frame.height);
  return { scale, x: (rotated.width - frame.width * scale) / 2, y: (rotated.height - frame.height * scale) / 2 };
}

export function mapRotationCrop(rect: Rect, mapping: ReturnType<typeof rotationFrameMapping>): Rect {
  return { x: mapping.x + rect.x * mapping.scale, y: mapping.y + rect.y * mapping.scale,
    width: rect.width * mapping.scale, height: rect.height * mapping.scale };
}

export function moveCrop(rect: Rect, dx: number, dy: number, bounds: Rect): Rect {
  return { ...rect, x: clamp(Math.round(rect.x + dx), 0, bounds.width - rect.width), y: clamp(Math.round(rect.y + dy), 0, bounds.height - rect.height) };
}

export function fitCropRatio(rect: Rect, ratio: number, bounds: Rect): Rect {
  const width = Math.min(rect.width, rect.height * ratio, bounds.width, bounds.height * ratio);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(width / ratio));
  return { x: clamp(Math.round(rect.x + (rect.width - w) / 2), 0, bounds.width - w),
    y: clamp(Math.round(rect.y + (rect.height - h) / 2), 0, bounds.height - h), width: w, height: h };
}

export function resizeCrop(rect: Rect, handle: CropHandle, dx: number, dy: number, bounds: Rect, ratio?: number): Rect {
  const west = handle.includes("w"), north = handle.includes("n");
  const horizontal = west || handle.includes("e"), vertical = north || handle.includes("s");
  let width = horizontal ? clamp(rect.width + (west ? -dx : dx), 1, west ? rect.x + rect.width : bounds.width - rect.x) : rect.width;
  let height = vertical ? clamp(rect.height + (north ? -dy : dy), 1, north ? rect.y + rect.height : bounds.height - rect.y) : rect.height;
  if (ratio) {
    if (horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy * ratio))) height = width / ratio;
    else width = height * ratio;
    const maxW = horizontal ? (west ? rect.x + rect.width : bounds.width - rect.x) : 2 * Math.min(rect.x + rect.width / 2, bounds.width - rect.x - rect.width / 2);
    const maxH = vertical ? (north ? rect.y + rect.height : bounds.height - rect.y) : 2 * Math.min(rect.y + rect.height / 2, bounds.height - rect.y - rect.height / 2);
    width = Math.min(width, maxW, maxH * ratio);
    height = width / ratio;
  }
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  const x = west ? rect.x + rect.width - width : horizontal ? rect.x : rect.x + (rect.width - width) / 2;
  const y = north ? rect.y + rect.height - height : vertical ? rect.y : rect.y + (rect.height - height) / 2;
  return { x: clamp(Math.round(x), 0, bounds.width - width), y: clamp(Math.round(y), 0, bounds.height - height), width, height };
}

/** Convert the quantized original selection to coordinates on an editing bitmap. */
export function bitmapCrop(photo: CropPhoto, width: number, height: number): Rect {
  const rect = cropPixels(photo);
  const bounds = rotationDimensions(photo.width, photo.height, photo.crop?.rotation);
  return { x: rect.x / bounds.width * width, y: rect.y / bounds.height * height,
    width: rect.width / bounds.width * width, height: rect.height / bounds.height * height };
}
