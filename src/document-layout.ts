import { calculateGeometry, layerPosition, resolveLayerText } from "./editor-model.ts";
import { isVisible } from "./canvas-camera.ts";
import { arrangementAxis, arrangeSelection, canPositionAlongAxis, distributionMetrics, distributionReference, selectionLineAxis, type AlignReference, type ArrangeAction, type LayerPatch } from "./selection-model.ts";
import type { CanvasGeometry, DistributionRange, DistributionRule, EditorDocument, PhotoAsset, WatermarkLayer } from "./types";

export type TextSize = (layer: WatermarkLayer, text: string) => { width: number; height: number };

export const hasLayoutRules = (document: EditorDocument) => !!(document.distributions?.length || document.alignments?.length);

export function measureDocumentLayers(document: EditorDocument, photo: PhotoAsset, measure: TextSize, layerIds: string[], geometry = calculateGeometry(photo, document)) {
  return document.layers.filter(layer => layerIds.includes(layer.id) && isVisible(layer, document.regions)).map(layer => {
    const size = measure(layer, resolveLayerText(layer, photo));
    const width = layer.rotation ? size.height : size.width, height = layer.rotation ? size.width : size.height;
    const position = layerPosition(layer, geometry);
    return { id: layer.id, position, bounds: { x: position.x - width / 2, y: position.y - height / 2, width, height } };
  });
}

export function resolveDocumentLayout(source: EditorDocument, photo: PhotoAsset, measure: TextSize): EditorDocument {
  if (!hasLayoutRules(source)) return source;
  const result = structuredClone(source);
  const geometry = calculateGeometry(photo, result);
  const apply = (layerIds: string[], action: ArrangeAction, reference: AlignReference, distribution?: DistributionRule) => {
    const layers = result.layers.filter(layer => layerIds.includes(layer.id) && isVisible(layer, result.regions));
    const measured = measureDocumentLayers(result, photo, measure, layerIds, geometry);
    const patches = arrangeSelection(action, reference, measured, layers, geometry, result.regions, distribution);
    for (const {id,patch} of patches) {
      Object.assign(result.layers.find(layer => layer.id === id)!, patch);
    }
    return patches.length > 0;
  };
  for (const rule of result.distributions ?? []) apply(rule.layerIds, rule.axis === "x" ? "distribute-x" : "distribute-y", "canvas", rule);
  // Distribute first, then position the complete group using its current text.
  for (const rule of result.alignments ?? []) {
    if (!apply(rule.layerIds, rule.action, rule.reference)) continue;
    const axis = arrangementAxis(rule.action, rule.reference);
    // Persist the resulting center when an outer alignment translates a ranged
    // group. Resolving an already-resolved document must remain idempotent.
    for (const distribution of result.distributions ?? []) {
      if (!distribution.range || distribution.axis !== axis || !distribution.layerIds.every(id => rule.layerIds.includes(id))) continue;
      const metrics = distributionMetrics(distribution.axis, distribution.range.reference, measureDocumentLayers(result, photo, measure, distribution.layerIds, geometry), geometry, result.regions);
      const dimension = distribution.axis === "x" ? "width" : "height";
      if (metrics) distribution.range.anchor = (metrics.bounds[distribution.axis] + metrics.bounds[dimension] / 2 - metrics.rect[distribution.axis]) / metrics.rect[dimension];
    }
  }
  return result;
}

export function pruneLayoutRules(document: EditorDocument) {
  const present = (rule: {layerIds: string[]}) => rule.layerIds.every(id => document.layers.some(layer => layer.id === id));
  document.distributions = document.distributions?.filter(present);
  document.alignments = document.alignments?.filter(present);
  if (!document.distributions?.length) delete document.distributions;
  if (!document.alignments?.length) delete document.alignments;
}

export function releaseLayoutRules(document: EditorDocument, patches: LayerPatch[], geometry?: CanvasGeometry) {
  const byId = new Map(patches.map(({id,patch}) => [id,patch]));
  const deltas = (ids: string[], axis: "x" | "y") => ids.map(id => {
    const layer = document.layers.find(item => item.id === id);
    const patch = byId.get(id);
    if (!layer || (patch?.region !== undefined && patch.region !== layer.region)) return NaN;
    const size = geometry?.regions[layer.region][axis === "x" ? "width" : "height"] ?? 1;
    return patch?.[axis] === undefined ? 0 : (patch[axis]! - layer[axis]) * size;
  });
  const uniform = (values: number[]) => values.every(value => Math.abs(value - values[0]) < 1e-7);
  document.distributions = document.distributions?.filter(rule => {
    const values = deltas(rule.layerIds, rule.axis);
    if (!uniform(values)) return false;
    if (rule.range && geometry && values[0]) {
      const rect = distributionReference(rule.range.reference, geometry, document.regions);
      const length = rect[rule.axis === "x" ? "width" : "height"];
      if (length <= 0) return false;
      rule.range.anchor += values[0] / length;
    }
    return true;
  });
  document.alignments = document.alignments?.filter(rule => {
    const values = deltas(rule.layerIds, arrangementAxis(rule.action, rule.reference));
    return rule.reference === "selection" ? uniform(values) : values.every(value => Math.abs(value) < 1e-7);
  });
  pruneLayoutRules(document);
}

export function commitArrangement(document: EditorDocument, patches: LayerPatch[], action: ArrangeAction, reference: AlignReference, geometry: CanvasGeometry) {
  const distributions = document.distributions ?? [];
  const alignments = document.alignments ?? [];
  const layerIds = patches.map(({id}) => id);
  const ids = new Set(layerIds);
  const overlaps = (rule: {layerIds: string[]}) => rule.layerIds.some(id => ids.has(id));
  const axis = arrangementAxis(action, reference);
  releaseLayoutRules(document, patches, geometry);
  for (const {id,patch} of patches) Object.assign(document.layers.find(layer => layer.id === id)!, patch);
  if (action === "distribute-x" || action === "distribute-y") {
    // Distributing a whole group preserves its outer bounds and alignment.
    const preserved = alignments.filter(rule => rule.reference !== "selection" && arrangementAxis(rule.action, rule.reference) === axis && rule.layerIds.length === ids.size && rule.layerIds.every(id => ids.has(id)));
    document.alignments = [...new Set([...(document.alignments ?? []), ...preserved])];
    const range = distributions.find(rule => rule.axis === axis && rule.layerIds.length === ids.size && rule.layerIds.every(id => ids.has(id)))?.range;
    document.distributions = [...(document.distributions ?? []).filter(rule => rule.axis !== axis || !overlaps(rule)), {axis,layerIds,...(range ? {range} : {})}];
    document.alignments = document.alignments.filter(rule => rule.reference !== "selection" || arrangementAxis(rule.action, rule.reference) !== axis || !overlaps(rule));
  } else {
    // Moving the whole group to a reference does not change its internal gaps.
    const preserved = distributions.filter(rule => rule.axis === axis && reference !== "selection" && rule.layerIds.every(id => ids.has(id)));
    document.distributions = [...new Set([...(document.distributions ?? []), ...preserved])].filter(rule => reference !== "selection" || rule.axis !== axis || !overlaps(rule));
    document.alignments = [...(document.alignments ?? []).filter(rule => arrangementAxis(rule.action, rule.reference) !== axis || !overlaps(rule)), {action,reference,layerIds}];
  }
  pruneLayoutRules(document);
}

export function setDistributionRange(document: EditorDocument, photo: PhotoAsset, layerIds: string[], axis: "x" | "y", setting: Pick<DistributionRange,"reference" | "ratio"> | null, measure: TextSize): boolean {
  const ids = new Set(layerIds);
  const matches = (rule: DistributionRule) => rule.axis === axis && rule.layerIds.length === ids.size && rule.layerIds.every(id => ids.has(id));
  if (!setting) {
    if (!document.distributions?.some(rule => matches(rule) && rule.range)) return false;
    document.distributions = document.distributions?.filter(rule => !matches(rule) || rule.layerIds.length >= 3);
    for (const rule of document.distributions ?? []) if (matches(rule)) delete rule.range;
    pruneLayoutRules(document);
    return true;
  }
  if (!Number.isFinite(setting.ratio) || setting.ratio <= 0 || setting.ratio > 1) return false;
  const geometry = calculateGeometry(photo, document);
  const measured = measureDocumentLayers(document, photo, measure, layerIds, geometry);
  const layers = document.layers.filter(layer => ids.has(layer.id));
  if (measured.length !== ids.size || selectionLineAxis(measured) !== axis || !canPositionAlongAxis(axis, layers, geometry)) return false;
  const metrics = distributionMetrics(axis, setting.reference, measured, geometry, document.regions);
  if (!metrics) return false;
  const dimension = axis === "x" ? "width" : "height";
  const previous = document.distributions?.find(matches);
  const order = previous?.range ? previous.layerIds : [...measured].sort((a,b)=>a.bounds[axis]-b.bounds[axis]).map(item=>item.id);
  const range = {...setting,anchor:(metrics.bounds[axis]+metrics.bounds[dimension]/2-metrics.rect[axis])/metrics.rect[dimension]};
  document.distributions = [...(document.distributions ?? []).filter(rule => rule.axis !== axis || !rule.layerIds.some(id=>ids.has(id))),{axis,layerIds:order,range}];
  document.alignments = document.alignments?.filter(rule => arrangementAxis(rule.action, rule.reference) !== axis || !rule.layerIds.some(id=>ids.has(id)) || (rule.reference !== "selection" && rule.layerIds.length === ids.size && rule.layerIds.every(id=>ids.has(id))));
  pruneLayoutRules(document);
  Object.assign(document, resolveDocumentLayout(document, photo, measure));
  return true;
}
