import { useEffect, useMemo, useRef, useState } from "react";
import { ensureFontsLoaded, fontsChangedEvent } from "./font-library";
import { layoutWatermarkText } from "./watermark-text";
import { hasLayoutRules, measureDocumentLayers, resolveDocumentLayout, setDistributionRange } from "./document-layout";
import { isVisible } from "./canvas-camera";
import type { DistributionRange, EditorDocument, PhotoAsset, WatermarkLayer } from "./types";

const textSize = (layer: WatermarkLayer, text: string) => layoutWatermarkText(layer, text);

export const resolveBrowserLayout = (document: EditorDocument, photo: PhotoAsset) => resolveDocumentLayout(document, photo, textSize);
export const measureBrowserLayers = (document: EditorDocument, photo: PhotoAsset, ids: string[]) => measureDocumentLayers(document, photo, textSize, ids);
export const setBrowserDistributionRange = (document: EditorDocument, photo: PhotoAsset, ids: string[], axis: "x" | "y", setting: Pick<DistributionRange,"reference" | "ratio"> | null) => setDistributionRange(document, photo, ids, axis, setting, textSize);

export function useDocumentLayouts(raw: Record<string, EditorDocument>, photos: PhotoAsset[]) {
  const [revision, setRevision] = useState(0);
  const cache=useRef(new WeakMap<EditorDocument,WeakMap<PhotoAsset,{revision:number;document:EditorDocument}>>());
  const families = JSON.stringify([...new Set(Object.values(raw).filter(hasLayoutRules).flatMap(doc => doc.layers.filter(layer => isVisible(layer, doc.regions)).map(layer => layer.fontFamily)))]);
  useEffect(() => {
    let alive = true;
    const load = () => { void ensureFontsLoaded(JSON.parse(families)).then(() => { if (alive) setRevision(value => value + 1); }).catch(() => {}); };
    if (families !== "[]") load();
    window.addEventListener(fontsChangedEvent, load);
    return () => { alive = false; window.removeEventListener(fontsChangedEvent, load); };
  }, [families]);
  return useMemo(() => {
    const byId=new Map(photos.map(photo=>[photo.id,photo]));
    return Object.fromEntries(Object.entries(raw).map(([id,doc]) => {
      const photo=byId.get(id);
      if(!photo || !hasLayoutRules(doc))return [id,doc];
      let entries=cache.current.get(doc);
      if(!entries){entries=new WeakMap();cache.current.set(doc,entries);}
      let entry=entries.get(photo);
      if(!entry || entry.revision!==revision){entry={revision,document:resolveBrowserLayout(doc,photo)};entries.set(photo,entry);}
      return [id,entry.document];
    }));
  }, [raw,photos,revision]);
}
