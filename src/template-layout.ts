import { cloneDocument, photoOrientation } from "./editor-model.ts";
import { pruneLayoutRules, resolveDocumentLayout, type TextSize } from "./document-layout.ts";
import type { EditorDocument, PhotoAsset, TemplateRecord } from "./types";

// Carry photo-specific edits across orientation changes instead of replacing
// the entire current composition with the other template layout.
export function reorientTemplateDocument(template: TemplateRecord | undefined, before: PhotoAsset, after: PhotoAsset, current: EditorDocument, measure: TextSize): EditorDocument {
  if (!template || photoOrientation(before) === photoOrientation(after)) return current;
  const source = template.layouts[photoOrientation(before)];
  const target = template.layouts[photoOrientation(after)];
  if (!source || !target) return current;
  // Compare both documents in the old photo's geometry and font metrics.
  // Resolved coordinates/anchors are layout results, not user edits.
  const base = resolveDocumentLayout(source, before, measure);
  const localDocument = resolveDocumentLayout(current, before, measure);
  const result = cloneDocument(target);
  const edits = <T extends object>(original: T, local: T, destination: T) => {
    for (const key of Object.keys(local) as (keyof T)[]) {
      if (!sameLayoutValue(original[key], local[key])) destination[key] = structuredClone(local[key]);
    }
  };
  edits(base.frame, localDocument.frame, result.frame);
  for (const region of ["top", "bottom", "left", "right"] as const) edits(base.regions[region], localDocument.regions[region], result.regions[region]);
  result.layers = result.layers.filter(layer => !base.layers.some(old => old.id === layer.id) || localDocument.layers.some(local => local.id === layer.id));
  for (const local of localDocument.layers) {
    const original = base.layers.find(layer => layer.id === local.id);
    const destination = result.layers.find(layer => layer.id === local.id);
    if (!original || !destination) {
      if (!original || !sameLayoutValue(original, local)) {
        if(destination)Object.assign(destination,structuredClone(local));else result.layers.push(structuredClone(local));
      }
    } else edits(original, local, destination);
  }
  if (!sameLayoutValue(base.distributions, localDocument.distributions)) result.distributions = structuredClone(localDocument.distributions);
  if (!sameLayoutValue(base.alignments, localDocument.alignments)) result.alignments = structuredClone(localDocument.alignments);
  // An orientation may omit a layer that was added to the other layout.
  pruneLayoutRules(result);
  return result;
}

function sameLayoutValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // Re-resolving a saved layout can introduce sub-pixel floating-point noise.
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameLayoutValue(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => sameLayoutValue(left[key], right[key]));
}
