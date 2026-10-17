import type { CanvasGeometry, Rect, RegionId, WatermarkLayer } from "./types";

export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };
export type Size = { width: number; height: number };
export type Guide = { axis: "x" | "y"; value: number; label: string; color: string };

export const regionNames: Record<RegionId, string> = {
  canvas: "整个画布", top: "上参数区", bottom: "下参数区", left: "左参数区", right: "右参数区",
};
export const clampZoom = (zoom: number, maximum = 300) => Math.max(10, Math.min(maximum, zoom));
export const previewMaximumZoom = 1600;
export const baseScale = (width: number) => Math.max(420, Math.min(860, width * 0.48)) / width;
export const screenToWorld = (point: Point, camera: Camera): Point => ({
  x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale,
});

// The same affine transform drives painting, hit testing, zoom and panning.
// No DOM scroll offsets, rounded layout sizes or compensating second frame.
export function zoomAt(camera: Camera, scale: number, anchor: Point): Camera {
  const world = screenToWorld(anchor, camera);
  return { x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale };
}

export function fitCamera(viewport: Size, scene: Size, maximum = 300, padding = 80): Camera {
  const base = baseScale(scene.width);
  const scale = base * clampZoom(Math.min(
    Math.max(1, viewport.width - padding) / scene.width,
    Math.max(1, viewport.height - padding) / scene.height,
  ) / base * 100, maximum) / 100;
  return { x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2, scale };
}

export function safeRect(rect: Rect, safe: number): Rect {
  const inset = Math.min(rect.width, rect.height) * safe / 100;
  return { x: rect.x + inset, y: rect.y + inset, width: Math.max(1, rect.width - inset * 2), height: Math.max(1, rect.height - inset * 2) };
}

export function isVisible(layer: WatermarkLayer, regions: Record<string, { enabled: boolean }>) {
  return layer.visible && (layer.region === "canvas" || regions[layer.region].enabled);
}

export function snapSelection(bounds: Rect, delta: Point, geometry: CanvasGeometry, regions: { id: RegionId; bounds: Rect }[], others: { bounds: Rect; name: string }[], scale: number, enabled: boolean) {
  if (!enabled) return { delta, guides: [] as Guide[] };
  const targets: (Guide & { edge: boolean; priority: number })[] = [];
  const add = (rect: Rect, label: string, color: string, priority: number, thirds = false) => {
    for (const axis of ["x", "y"] as const) {
      const length = axis === "x" ? rect.width : rect.height;
      for (const fraction of [0, 0.5, 1, ...(thirds ? [1 / 3, 2 / 3] : [])]) {
        targets.push({ axis, value: rect[axis] + length * fraction, color, edge: fraction === 0 || fraction === 1,
          priority: fraction === 0 || fraction === 1 ? 3 : priority,
          label: `${label} · ${fraction === 0.5 ? "中心" : fraction === 0 || fraction === 1 ? "边缘" : fraction < 0.5 ? "1/3" : "2/3"}` });
      }
    }
  };
  add(geometry.regions.canvas, "画布", "#63aaf2", 0);
  add(geometry.photo, "照片", "#e6a75c", 2);
  regions.forEach(region => add(region.bounds, regionNames[region.id], "#b889ef", 1, true));
  others.forEach(item => add(item.bounds, item.name, "#82c6bd", 2));
  const result = { ...delta };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    const length = axis === "x" ? bounds.width : bounds.height;
    const candidates = targets.filter(target => target.axis === axis).flatMap(target =>
      (target.edge ? [0, length] : [length / 2]).map(offset => ({ target, correction: target.value - bounds[axis] - delta[axis] - offset })))
      .filter(item => Math.abs(item.correction) * scale <= 6)
      .sort((a, b) => a.target.priority - b.target.priority || Math.abs(a.correction) - Math.abs(b.correction));
    const best = candidates[0];
    if (best) { result[axis] += best.correction; guides.push(best.target); }
  }
  return { delta: result, guides };
}
