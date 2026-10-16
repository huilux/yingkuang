import { cloneDocument, photoOrientation } from "./editor-model.ts";
import type { EditorDocument, PhotoAsset, TemplateRecord } from "./types";

// Carry photo-specific edits across orientation changes instead of replacing
// the entire current composition with the other template layout.
export function reorientTemplateDocument(template: TemplateRecord | undefined, before: PhotoAsset, after: PhotoAsset, current: EditorDocument): EditorDocument {
  if (!template || photoOrientation(before) === photoOrientation(after)) return current;
  const base = template.layouts[photoOrientation(before)];
  const target = template.layouts[photoOrientation(after)];
  if (!base || !target) return current;
  const result = cloneDocument(target);
  const edits = <T extends object>(original: T, local: T, destination: T) => {
    for (const key of Object.keys(local) as (keyof T)[]) {
      if (JSON.stringify(original[key]) !== JSON.stringify(local[key])) destination[key] = structuredClone(local[key]);
    }
  };
  edits(base.frame, current.frame, result.frame);
  for (const region of ["top", "bottom", "left", "right"] as const) edits(base.regions[region], current.regions[region], result.regions[region]);
  result.layers = result.layers.filter(layer => !base.layers.some(old => old.id === layer.id) || current.layers.some(local => local.id === layer.id));
  for (const local of current.layers) {
    const original = base.layers.find(layer => layer.id === local.id);
    const destination = result.layers.find(layer => layer.id === local.id);
    if (!original || !destination) {
      if (!original || JSON.stringify(original) !== JSON.stringify(local)) {
        if(destination)Object.assign(destination,structuredClone(local));else result.layers.push(structuredClone(local));
      }
    } else edits(original, local, destination);
  }
  if (JSON.stringify(base.distributions) !== JSON.stringify(current.distributions)) result.distributions = structuredClone(current.distributions);
  // An orientation may omit a layer that was added to the other layout.
  if (result.distributions) result.distributions = result.distributions.filter(rule => rule.layerIds.every(id => result.layers.some(layer => layer.id === id)));
  return result;
}
