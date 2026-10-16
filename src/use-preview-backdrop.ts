import { useEffect, useState } from "react";
import type { CanvasGeometry, FrameSettings, PhotoAsset } from "./types";
import { bitmapCrop } from "./photo-crop";
import { rotatedPhotoBitmap } from "./photo-transform";

const escapeXml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

async function embeddedSource(source: string, signal: AbortSignal): Promise<string> {
  if (source.startsWith("data:")) return source;
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error("无法读取预览图片");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function rasterize(source: string, frame: FrameSettings, geometry: CanvasGeometry, signal: AbortSignal, includePhoto = true, maxDimension = 1600, photoSource?: PhotoAsset) {
  let embedded = await embeddedSource(source, signal);
  let photograph: HTMLImageElement | HTMLCanvasElement | undefined;
  if (signal.aborted) return null;
  if (photoSource?.crop) {
    const original = new Image();
    original.src = embedded;
    await original.decode();
    if (signal.aborted) return null;
    const rotated = rotatedPhotoBitmap(original, photoSource.width, photoSource.height, photoSource.crop.rotation);
    const crop = bitmapCrop(photoSource, rotated.width, rotated.height);
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(crop.width));
    cropped.height = Math.max(1, Math.round(crop.height));
    const context = cropped.getContext("2d");
    if (!context) throw new Error("无法生成裁切预览");
    context.drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, cropped.width, cropped.height);
    embedded = cropped.toDataURL("image/png");
    photograph = cropped;
  }
  if (includePhoto && !photograph) {
    photograph = new Image();
    photograph.src = embedded;
    await photograph.decode();
  }
  const href = escapeXml(embedded);
  if (signal.aborted) return null;
  const { width, height, photo } = geometry;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const overscan = Math.min(Math.min(width, height) * 0.25, Math.max(Math.min(width, height) * 0.08, frame.blur * 3));
  // SVG filters are used only for bounded, offscreen rasterization. WebKitGTK
  // lacks Canvas2D.filter. Keep the resulting canvas: no PNG encode/decode loop.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter color-interpolation-filters="linearRGB" id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${frame.blur}"/><feComponentTransfer>${["R", "G", "B"].map(channel => `<feFunc${channel} type="linear" slope="${frame.brightness / 100}"/>`).join("")}</feComponentTransfer></filter>
      <filter id="shadow-only" color-interpolation-filters="sRGB" x="${photo.x - frame.shadow * 1.68}" y="${photo.y - frame.shadow * 1.68}" width="${photo.width + frame.shadow * 3.36}" height="${photo.height + frame.shadow * 3.64}" filterUnits="userSpaceOnUse"><feGaussianBlur in="SourceAlpha" stdDeviation="${frame.shadow * 0.42}"/><feOffset dy="${frame.shadow * 0.28}" result="offset"/><feFlood flood-color="#070909" flood-opacity="${Math.min(0.9, frame.shadow / 100)}"/><feComposite in2="offset" operator="in"/></filter>
    </defs>
    <rect width="${width}" height="${height}" fill="${escapeXml(frame.color)}"/>
    ${frame.type === "blur" ? `<image href="${href}" x="${-overscan}" y="${-overscan}" width="${width + 2 * overscan}" height="${height + 2 * overscan}" preserveAspectRatio="xMidYMid slice" filter="url(#blur)"/><rect width="${width}" height="${height}" fill="#101312" opacity="0.08"/>` : ""}
    ${frame.shadow ? `<rect x="${photo.x}" y="${photo.y}" width="${photo.width}" height="${photo.height}" rx="${frame.radius * 2}" filter="url(#shadow-only)"/>` : ""}
  </svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法载入相框预览"));
    });
    image.src = url;
    await loaded;
    await image.decode();
    if (signal.aborted) return null;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成相框预览");
    context.drawImage(image, 0, 0);
    // SVG image decoding in WebKit does not reliably make embedded JPEG pixels
    // available for concurrent snapshots. Composite the decoded photo directly.
    if (includePhoto && photograph) {
      context.save();
      context.scale(canvas.width / width, canvas.height / height);
      context.beginPath();
      context.roundRect(photo.x, photo.y, photo.width, photo.height,
        Math.min(frame.radius * 2, photo.width / 2, photo.height / 2));
      context.clip();
      context.imageSmoothingQuality = "high";
      context.drawImage(photograph, photo.x, photo.y, photo.width, photo.height);
      context.restore();
    }
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function usePreviewBackdrop(source: string, frame: FrameSettings, geometry: CanvasGeometry, photo?: PhotoAsset) {
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);
  // Dependencies describe pixels, not the document or its watermark positions.
  const key = JSON.stringify([source, frame, geometry.width, geometry.height, geometry.photo, photo?.crop, photo?.width, photo?.height]);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    const timer = window.setTimeout(() => {
      void rasterize(source, frame, geometry, controller.signal, false, 1600, photo).then(result => {
        if (result && !controller.signal.aborted) setImage(result);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    }, 60);
    // Retain the last usable bitmap during slider input; stale work cannot
    // overwrite the latest parameters. Photo switches remount the editor.
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key]);
  return { image, error };
}
