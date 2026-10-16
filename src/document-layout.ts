import { calculateGeometry, layerPosition, resolveLayerText } from "./editor-model.ts";
import { isVisible } from "./canvas-camera.ts";
import { arrangeSelection, type LayerPatch } from "./selection-model.ts";
import type { EditorDocument, PhotoAsset, WatermarkLayer } from "./types";

export type TextSize = (layer: WatermarkLayer, text: string) => { width: number; height: number };

export function resolveDocumentLayout(source: EditorDocument, photo: PhotoAsset, measure: TextSize): EditorDocument {
  if (!source.distributions?.length) return source;
  const result = structuredClone(source);
  const geometry = calculateGeometry(photo, result);
  for (const rule of result.distributions!) {
    const layers = result.layers.filter(layer => rule.layerIds.includes(layer.id) && isVisible(layer, result.regions));
    if (layers.length < 3) continue;
    const measured = layers.map(layer => {
      const size = measure(layer, resolveLayerText(layer, photo));
      const width = layer.rotation ? size.height : size.width;
      const height = layer.rotation ? size.width : size.height;
      const position = layerPosition(layer, geometry);
      return { id: layer.id, position, bounds: { x: position.x - width / 2, y: position.y - height / 2, width, height } };
    });
    for (const {id,patch} of arrangeSelection(rule.axis === "x" ? "distribute-x" : "distribute-y", "canvas", measured, layers, geometry)) {
      Object.assign(result.layers.find(layer => layer.id === id)!, patch);
    }
  }
  return result;
}

export function releaseDistributionRules(document: EditorDocument, patches: LayerPatch[]) {
  if (!document.distributions) return;
  document.distributions = document.distributions.filter(rule => !patches.some(({id,patch}) => {
    const layer=document.layers.find(layer=>layer.id===id);
    return rule.layerIds.includes(id) && layer && (
      (patch[rule.axis]!==undefined && Math.abs(patch[rule.axis]!-layer[rule.axis])>1e-9) ||
      (patch.region!==undefined && patch.region!==layer.region));
  }));
  if (!document.distributions.length) delete document.distributions;
}
