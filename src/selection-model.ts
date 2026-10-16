import type { AlignmentRule, CanvasGeometry, DistributionRange, DistributionRule, EditorDocument, Rect, WatermarkLayer } from "./types";
import { safeRect } from "./canvas-camera.ts";

export type LayerPatch = { id: string; patch: Partial<WatermarkLayer> };
export type Point = { x: number; y: number };
export type MeasuredLayer = { id: string; position: Point; bounds: Rect };
export type ArrangeAction = AlignmentRule["action"] | "distribute-x" | "distribute-y";
export type AlignReference = AlignmentRule["reference"];

export function arrangementAxis(action: ArrangeAction, reference: AlignReference): "x" | "y" {
  if (action === "third-1" || action === "third-2") return reference === "left" || reference === "right" ? "x" : "y";
  return ["left", "center-x", "right", "distribute-x"].includes(action) ? "x" : "y";
}

export function selectLayer(current: string[], id: string, extend = false, preserveGroup = false): string[] {
  if (!id) return [];
  if (extend) return current.includes(id) ? current.filter(value => value !== id) : [...current, id];
  return preserveGroup && current.includes(id) ? current : [id];
}

export function unionBounds(items: { bounds: Rect }[]): Rect | null {
  if (!items.length) return null;
  const x = Math.min(...items.map(item => item.bounds.x));
  const y = Math.min(...items.map(item => item.bounds.y));
  return { x, y, width: Math.max(...items.map(item => item.bounds.x + item.bounds.width)) - x,
    height: Math.max(...items.map(item => item.bounds.y + item.bounds.height)) - y };
}

/** A range edits spacing along an existing line; it never changes its direction. */
export function selectionLineAxis(measured: MeasuredLayer[]): "x" | "y" | null {
  if (measured.length < 2 || measured.some(item => !Number.isFinite(item.position.x) || !Number.isFinite(item.position.y) || item.bounds.width <= 0 || item.bounds.height <= 0)) return null;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const tolerance = (dimension: "width" | "height") => Math.min(2, Math.max(.5, Math.min(...measured.map(item => item.bounds[dimension])) * .1));
  const aligned = (axis: "x" | "y", dimension: "width" | "height") => [
    measured.map(item => item.position[axis]),
    measured.map(item => item.bounds[axis]),
    measured.map(item => item.bounds[axis] + item.bounds[dimension]),
  ].some(values => spread(values) <= tolerance(dimension) + 1e-7);
  const row = aligned("y", "height") && spread(measured.map(item => item.position.x)) > tolerance("width");
  const column = aligned("x", "width") && spread(measured.map(item => item.position.y)) > tolerance("height");
  return row === column ? null : row ? "x" : "y";
}

export function canPositionAlongAxis(axis: "x" | "y", layers: WatermarkLayer[], geometry: CanvasGeometry): boolean {
  const dimension = axis === "x" ? "width" : "height";
  // positionPatch uses a minimum denominator of one world unit.
  return layers.length > 0 && layers.every(layer => {
    const length = geometry.regions[layer.region][dimension];
    return Number.isFinite(length) && length >= 1;
  });
}

// Region coordinates are relative, not a clipping constraint. As in the
// prototype, an element may cross its region while staying attached to it.
// Clamping each element independently would deform a multi-selection.
export function positionPatch(layer: WatermarkLayer, point: Point, geometry: CanvasGeometry): LayerPatch {
  const rect = geometry.regions[layer.region];
  return { id: layer.id, patch: { x: (point.x - rect.x) / Math.max(1, rect.width), y: (point.y - rect.y) / Math.max(1, rect.height) } };
}

export function moveSelection(layers: WatermarkLayer[], geometry: CanvasGeometry, delta: Point): LayerPatch[] {
  return layers.map(layer => {
    const rect = geometry.regions[layer.region];
    return positionPatch(layer, { x: rect.x + layer.x * rect.width + delta.x, y: rect.y + layer.y * rect.height + delta.y }, geometry);
  });
}

export function distributionReference(reference: DistributionRange["reference"], geometry: CanvasGeometry, regions: EditorDocument["regions"]): Rect {
  if (reference === "photo") return geometry.photo;
  if (reference === "canvas") return geometry.regions.canvas;
  return safeRect(geometry.regions[reference], regions[reference].safePadding);
}

export function distributionMetrics(axis: "x" | "y", reference: DistributionRange["reference"], measured: MeasuredLayer[], geometry: CanvasGeometry, regions: EditorDocument["regions"]) {
  const bounds = unionBounds(measured), rect = distributionReference(reference, geometry, regions);
  const dimension = axis === "x" ? "width" : "height";
  if (!bounds || rect[dimension] <= 0 || (reference !== "canvas" && reference !== "photo" && !regions[reference].enabled)) return null;
  return { bounds, rect, ratio: bounds[dimension] / rect[dimension], minimumRatio: measured.reduce((sum, item) => sum + item.bounds[dimension], 0) / rect[dimension] };
}

export function arrangeSelection(action: ArrangeAction, reference: AlignReference, measured: MeasuredLayer[], layers: WatermarkLayer[], geometry: CanvasGeometry, regions?: EditorDocument["regions"], distribution?: DistributionRule): LayerPatch[] {
  const group = unionBounds(measured);
  if (!group) return [];
  const selected = new Map(layers.map(layer => [layer.id, layer]));
  const axis = arrangementAxis(action, reference);
  if (!canPositionAlongAxis(axis, measured.map(item => selected.get(item.id)!), geometry)) return [];
  const patch = (item: MeasuredLayer, delta: number): LayerPatch => {
    const point = {...item.position, [axis]:item.position[axis]+delta};
    const next = positionPatch(selected.get(item.id)!, point, geometry);
    return {id:item.id,patch:{[axis]:next.patch[axis]!}};
  };
  if (action === "distribute-x" || action === "distribute-y") {
    const range = distribution?.range;
    if (measured.length < (range ? 2 : 3)) return [];
    const dimension = axis === "x" ? "width" : "height";
    const sorted = [...measured].sort((a, b) => range ? distribution!.layerIds.indexOf(a.id) - distribution!.layerIds.indexOf(b.id) : a.bounds[axis] - b.bounds[axis]);
    let start = sorted[0].bounds[axis];
    const last = sorted[sorted.length - 1].bounds;
    const total = sorted.reduce((sum, item) => sum + item.bounds[dimension], 0);
    let span = last[axis] + last[dimension] - start;
    if (range && regions) {
      const metrics = distributionMetrics(axis, range.reference, measured, geometry, regions);
      if (!metrics) return [];
      span = Math.max(metrics.rect[dimension] * range.ratio, total);
      start = metrics.rect[axis] + metrics.rect[dimension] * range.anchor - span / 2;
    }
    const gap = (span - total) / (sorted.length - 1);
    let cursor = start;
    return sorted.map(item => {
      const delta = cursor - item.bounds[axis];
      cursor += item.bounds[dimension] + gap;
      return patch(item, delta);
    });
  }
  const rawRect = reference === "selection" ? group : reference === "photo" ? geometry.photo : geometry.regions[reference];
  const rect = regions && reference !== "selection" && reference !== "photo" && reference !== "canvas"
    ? safeRect(rawRect, regions[reference].safePadding) : rawRect;
  const thirds = action === "third-1" || action === "third-2";
  const dimension = axis === "x" ? "width" : "height";
  const fraction = action === "third-1" ? 1 / 3 : action === "third-2" ? 2 / 3 : action === "left" || action === "top" ? 0 : action === "right" || action === "bottom" ? 1 : 0.5;
  const anchor = thirds ? 0.5 : fraction;
  const target = rect[axis] + rect[dimension] * fraction;
  return measured.map(item => {
    const origin = reference === "selection" ? item.bounds : group;
    const delta = target - origin[axis] - origin[dimension] * anchor;
    return patch(item, delta);
  });
}
