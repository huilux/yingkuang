import { ensureFontsLoaded, fontsChangedEvent } from "./font-library";
import { useEffect, useState } from "react";
import { calculateGeometry, layerPosition, photoOrientation, resolveLayerText } from "./editor-model";
import { isVisible } from "./canvas-camera";
import { rasterize } from "./use-preview-backdrop";
import type { PhotoAsset, TemplateRecord } from "./types";
import { resolveBrowserLayout } from "./browser-layout";
import { layoutWatermarkText, paintWatermarkText } from "./watermark-text";

const sampleMetadata = {
  make: "CAMERA", model: "X", camera: "CAMERA X", lens: "50mm F1.8", focalLength: "50mm", aperture: "f/2.8",
  shutter: "1/250s", iso: "ISO100", capturedAt: "2026:08:22",
};

async function previewImage(template: TemplateRecord, activePhoto: PhotoAsset | undefined, signal: AbortSignal) {
  const source = activePhoto?.thumbnailDataUrl ?? template.cover;
  const sourceImage = new Image();
  sourceImage.src = source;
  await sourceImage.decode();
  if (signal.aborted) return null;
  const portraitOnly = !activePhoto && !template.layouts.landscape && !!template.layouts.portrait;
  const width = portraitOnly ? 1000 : sourceImage.naturalWidth;
  const height = portraitOnly ? 1500 : sourceImage.naturalHeight;
  const photo: PhotoAsset = activePhoto ?? {
    id: "template-preview", path: "", fileName: "预览照片", width, height,
    megapixels: width * height / 1_000_000, thumbnailDataUrl: source, metadata: sampleMetadata,
  };
  const sourceDocument = template.layouts[photoOrientation(photo)] ?? template.layouts.landscape ?? template.layouts.portrait;
  if (!sourceDocument) return null;
  await ensureFontsLoaded(sourceDocument.layers.filter(layer => isVisible(layer, sourceDocument.regions)).map(layer => layer.fontFamily));
  const document = resolveBrowserLayout(sourceDocument, photo);
  const geometry = calculateGeometry(photo, document);
  const canvas = await rasterize(source, document.frame, geometry, signal, true, 560, photo);
  if (!canvas || signal.aborted) return null;
  await ensureFontsLoaded(document.layers.filter(layer => isVisible(layer, document.regions)).map(layer => layer.fontFamily));
  await window.document.fonts.ready;
  if (signal.aborted) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.save();
  context.scale(canvas.width / geometry.width, canvas.height / geometry.height);
  context.beginPath();
  context.rect(0, 0, geometry.width, geometry.height);
  context.clip();
  for (const layer of document.layers) {
    if (!isVisible(layer, document.regions)) continue;
    const label = resolveLayerText(layer, photo);
    const position = layerPosition(layer, geometry);
    context.save();
    context.translate(position.x, position.y);
    context.rotate(layer.rotation * Math.PI / 180);
    const layout = layoutWatermarkText(layer, label);
    context.translate(-layout.width / 2, -layout.height / 2);
    context.globalAlpha = layer.opacity * (label.startsWith("未读取到") ? 0.55 : 1);
    paintWatermarkText(context, layout, layer.color);
    context.restore();
  }
  context.restore();
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function TemplatePreview({ template, photo, className = "" }: { template: TemplateRecord; photo?: PhotoAsset; className?: string }) {
  const [image, setImage] = useState("");
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const changed = () => setFontRevision(value => value + 1);
    window.addEventListener(fontsChangedEvent, changed);
    return () => window.removeEventListener(fontsChangedEvent, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setImage("");
    void previewImage(template, photo, controller.signal).then((result) => {
      if (result && !controller.signal.aborted) setImage(result);
    }).catch(() => {});
    return () => controller.abort();
  }, [template, photo, fontRevision]);
  return <span className={`template-preview ${className}`}>
    {image ? <img src={image} alt="" /> : <span className="template-preview-loading" aria-hidden="true" />}
  </span>;
}
