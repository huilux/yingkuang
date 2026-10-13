import { rotationDimensions } from "./photo-crop";

type Bitmap = (HTMLImageElement | HTMLCanvasElement);

/** Bounded editing bitmap; transforms always start from the original, never a previous rotation. */
export function paintRotatedPhoto(canvas: HTMLCanvasElement, source: Bitmap, width: number, height: number, rotation: number, maxDimension = 4096, frame?: { width: number; height: number }) {
  const rotated = rotationDimensions(width, height, rotation);
  const bounds = frame ?? rotated;
  const cover = frame ? Math.max(frame.width / rotated.width, frame.height / rotated.height) : 1;
  const scale = Math.min(source.width / width, source.height / height, maxDimension / Math.max(bounds.width, bounds.height));
  canvas.width = Math.max(1, Math.round(bounds.width * scale));
  canvas.height = Math.max(1, Math.round(bounds.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法生成旋转预览");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(canvas.width / bounds.width * cover, canvas.height / bounds.height * cover);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(source, -width / 2, -height / 2, width, height);
}

export function rotatedPhotoBitmap(source: Bitmap, width: number, height: number, rotation = 0): Bitmap {
  if (!rotation) return source;
  const canvas = document.createElement("canvas");
  paintRotatedPhoto(canvas, source, width, height, rotation);
  return canvas;
}
