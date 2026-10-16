import { calculateGeometry, layerPosition, resolveLayerText } from "./editor-model.ts";
import { isVisible } from "./canvas-camera.ts";
import { arrangementAxis, arrangeSelection, type AlignReference, type ArrangeAction, type LayerPatch } from "./selection-model.ts";
import type { CanvasGeometry, EditorDocument, PhotoAsset, WatermarkLayer } from "./types";

export type TextSize = (layer: WatermarkLayer, text: string) => { width: number; height: number };

export const hasLayoutRules = (document: EditorDocument) => !!(document.distributions?.length || document.alignments?.length);

export function resolveDocumentLayout(source: EditorDocument, photo: PhotoAsset, measure: TextSize): EditorDocument {
  if (!hasLayoutRules(source)) return source;
  const result = structuredClone(source);
  const geometry = calculateGeometry(photo, result);
  const apply = (layerIds: string[], action: ArrangeAction, reference: AlignReference) => {
    const layers = result.layers.filter(layer => layerIds.includes(layer.id) && isVisible(layer, result.regions));
    const measured = layers.map(layer => {
      const size = measure(layer, resolveLayerText(layer, photo));
      const width = layer.rotation ? size.height : size.width;
      const height = layer.rotation ? size.width : size.height;
      const position = layerPosition(layer, geometry);
      return { id: layer.id, position, bounds: { x: position.x - width / 2, y: position.y - height / 2, width, height } };
    });
    for (const {id,patch} of arrangeSelection(action, reference, measured, layers, geometry, result.regions)) {
      Object.assign(result.layers.find(layer => layer.id === id)!, patch);
    }
  };
  for (const rule of result.distributions ?? []) apply(rule.layerIds, rule.axis === "x" ? "distribute-x" : "distribute-y", "canvas");
  // Distribute first, then position the complete group using its current text.
  for (const rule of result.alignments ?? []) apply(rule.layerIds, rule.action, rule.reference);
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
  document.distributions = document.distributions?.filter(rule => uniform(deltas(rule.layerIds, rule.axis)));
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
    document.distributions = [...(document.distributions ?? []).filter(rule => rule.axis !== axis || !overlaps(rule)), {axis,layerIds}];
    document.alignments = document.alignments.filter(rule => rule.reference !== "selection" || arrangementAxis(rule.action, rule.reference) !== axis || !overlaps(rule));
  } else {
    // Moving the whole group to a reference does not change its internal gaps.
    const preserved = distributions.filter(rule => rule.axis === axis && reference !== "selection" && rule.layerIds.every(id => ids.has(id)));
    document.distributions = [...new Set([...(document.distributions ?? []), ...preserved])].filter(rule => reference !== "selection" || rule.axis !== axis || !overlaps(rule));
    document.alignments = [...(document.alignments ?? []).filter(rule => arrangementAxis(rule.action, rule.reference) !== axis || !overlaps(rule)), {action,reference,layerIds}];
  }
  pruneLayoutRules(document);
}
