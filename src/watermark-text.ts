import { fontMetricsRevision, previewFontFamily, previewFontRuns } from "./font-library";
import type { WatermarkLayer } from "./types";
import type Konva from "konva";

export type WatermarkTextRun = { text: string; font: string; x: number; baseline: number };
export type WatermarkTextLayout = { width: number; height: number; runs: WatermarkTextRun[] };
let context: CanvasRenderingContext2D | null;
let probe: HTMLCanvasElement | undefined;
let probeContext: CanvasRenderingContext2D | null;
const inkCenters = new Map<string, number>();

function inkBaseline(font: string, text: string, metrics: TextMetrics) {
  const key = JSON.stringify([fontMetricsRevision(), font, text]);
  const cached = inkCenters.get(key);
  if (cached !== undefined) return cached;
  let middle = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  const left = Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft)) + 2;
  const baseline = Math.ceil(metrics.actualBoundingBoxAscent) + 2;
  const width = Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight)) + left + 2;
  const height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 4;
  // Probe full runs in tiles: preserve shaping and pixel precision even for
  // long captions, while keeping each scratch allocation below two million pixels.
  if (text.trim() && Number.isFinite(width * height) && width > 0 && height > 4) {
    probe ??= document.createElement("canvas");
    probeContext ??= probe.getContext("2d", { willReadFrequently: true });
    if (probeContext) {
      const tileHeight = Math.min(height, 1024);
      const tileWidth = Math.min(width, 8192, Math.floor(2_000_000 / tileHeight));
      let first = Infinity, last = -1, faintFirst = Infinity, faintLast = -1;
      for (let top = 0; top < height; top += tileHeight) for (let start = 0; start < width; start += tileWidth) {
        probe.width = Math.min(tileWidth, width - start); probe.height = Math.min(tileHeight, height - top);
        probeContext.font = font;
        probeContext.textBaseline = "alphabetic";
        probeContext.textAlign = "left";
        probeContext.fillStyle = "#fff";
        probeContext.fillText(text, left - start, baseline - top);
        const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
        for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
          const alpha = pixels[(y * probe.width + x) * 4 + 3];
          if (alpha > 0) { faintFirst = Math.min(faintFirst, top + y); faintLast = Math.max(faintLast, top + y); }
          if (alpha > 32) { first = Math.min(first, top + y); last = Math.max(last, top + y); break; }
        }
      }
      if (last < 0) { first = faintFirst; last = faintLast; }
      if (last >= 0) middle = baseline - (first + last + 1) / 2;
    }
  }
  if (inkCenters.size >= 512) inkCenters.delete(inkCenters.keys().next().value!);
  inkCenters.set(key, middle);
  return middle;
}

/** Center actual glyph ink in each line, independently of a fallback face's ascent. */
export function layoutWatermarkText(layer: Pick<WatermarkLayer, "fontFamily" | "fontSize" | "fontWeight">, text: string): WatermarkTextLayout {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("无法测量水印文字");
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  const runs: WatermarkTextRun[] = [];
  let width = 0;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    let x = 0;
    for (const run of previewFontRuns(layer.fontFamily, line)) {
      const font = `${layer.fontWeight} ${layer.fontSize}px ${previewFontFamily(run.family)}`;
      context!.font = font;
      const metrics = context!.measureText(run.text);
      runs.push({ text: run.text, font, x, baseline: (index + .5) * layer.fontSize + inkBaseline(font, run.text, metrics) });
      x += metrics.width;
    }
    width = Math.max(width, x);
  });
  return { width, height: lines.length * layer.fontSize, runs };
}

export function paintWatermarkText(context: Konva.Context | CanvasRenderingContext2D, layout: WatermarkTextLayout, color: string) {
  if ("setAttr" in context) {
    context.setAttr("textBaseline", "alphabetic");
    context.setAttr("textAlign", "left");
    context.setAttr("fillStyle", color);
  } else {
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    context.fillStyle = color;
  }
  for (const run of layout.runs) {
    if ("setAttr" in context) context.setAttr("font", run.font);
    else context.font = run.font;
    context.fillText(run.text, run.x, run.baseline);
  }
}
