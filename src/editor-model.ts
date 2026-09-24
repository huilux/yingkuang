import type {
  CanvasGeometry,
  EditorDocument,
  MetadataKey,
  PhotoAsset,
  Rect,
  WatermarkLayer,
} from "./types";
import { builtInDefaultTemplateId, builtInTemplates } from "./builtin-template-catalog.ts";

export { builtInTemplates };

export const metadataOptions: Array<{ source: MetadataKey | "custom"; label: string }> = [
  { source: "camera", label: "相机型号" },
  { source: "lens", label: "镜头" },
  { source: "focalLength", label: "焦距" },
  { source: "aperture", label: "光圈" },
  { source: "shutter", label: "快门" },
  { source: "iso", label: "ISO" },
  { source: "capturedAt", label: "拍摄时间" },
  { source: "custom", label: "自定义文字" },
];

function layer(
  id: string,
  name: string,
  source: WatermarkLayer["source"],
  x: number,
  y: number,
  options: Partial<WatermarkLayer> = {},
): WatermarkLayer {
  return {
    id,
    name,
    source,
    customValue: "",
    region: "bottom",
    x,
    y,
    fontFamily: "Noto Sans CJK SC, sans-serif",
    fontSize: 22,
    fontWeight: 500,
    color: "#ffffff",
    opacity: 1,
    rotation: 0,
    visible: true,
    ...options,
  };
}

export function createDefaultDocument(): EditorDocument {
  const template = builtInTemplates().find((item) => item.id === builtInDefaultTemplateId());
  const layout = template?.layouts.landscape ?? template?.layouts.portrait;
  if (!layout) throw new Error("默认内置模板缺少可用布局");
  return cloneDocument(layout);
}

export function cloneDocument(document: EditorDocument): EditorDocument {
  return structuredClone(document);
}

export function photoOrientation(photo: PhotoAsset): "landscape" | "portrait" {
  return photo.width >= photo.height ? "landscape" : "portrait";
}

export function resolveLayerText(layer: WatermarkLayer, photo: PhotoAsset): string {
  if (layer.source === "custom") return layer.customValue;
  const override = photo.overrides?.[layer.source];
  const value = override ?? photo.metadata[layer.source];
  if (!value) return `未读取到${layer.name}`;
  return layer.source === "capturedAt" ? value.replace(/:/g, "/") : value;
}

export function calculateGeometry(photo: PhotoAsset, document: EditorDocument): CanvasGeometry {
  const ratio = photo.width / photo.height;
  const photoWidth = ratio >= 1 ? ratio * 1000 : 1000;
  const photoHeight = ratio >= 1 ? 1000 : 1000 / ratio;
  const horizontal = document.frame.paddingX * 10;
  const vertical = document.frame.paddingY * 10;
  const leftExtra = document.regions.left.enabled ? document.regions.left.extra * 10 : 0;
  const rightExtra = document.regions.right.enabled ? document.regions.right.extra * 10 : 0;
  const topExtra = document.regions.top.enabled ? document.regions.top.extra * 10 : 0;
  const bottomExtra = document.regions.bottom.enabled ? document.regions.bottom.extra * 10 : 0;
  const width = photoWidth + horizontal * 2 + leftExtra + rightExtra;
  const height = photoHeight + vertical * 2 + topExtra + bottomExtra;
  const photoRect: Rect = {
    x: horizontal + leftExtra,
    y: vertical + topExtra,
    width: photoWidth,
    height: photoHeight,
  };
  const top: Rect = { x: 0, y: 0, width, height: photoRect.y };
  const bottomY = photoRect.y + photoRect.height;
  const bottom: Rect = { x: 0, y: bottomY, width, height: height - bottomY };
  const left: Rect = { x: 0, y: photoRect.y, width: photoRect.x, height: photoRect.height };
  const rightX = photoRect.x + photoRect.width;
  const right: Rect = { x: rightX, y: photoRect.y, width: width - rightX, height: photoRect.height };
  return {
    width,
    height,
    photo: photoRect,
    regions: {
      canvas: { x: 0, y: 0, width, height },
      top,
      bottom,
      left,
      right,
    },
  };
}

export function layerPosition(layer: WatermarkLayer, geometry: CanvasGeometry) {
  const bounds = geometry.regions[layer.region];
  return {
    x: bounds.x + bounds.width * layer.x,
    y: bounds.y + bounds.height * layer.y,
  };
}

export function nextLayer(source: WatermarkLayer["source"], index: number): WatermarkLayer {
  const option = metadataOptions.find((item) => item.source === source);
  return layer(`layer-${Date.now()}-${index}`, option?.label ?? "文字", source, 0.5, 0.5, {
    customValue: source === "custom" ? "双击或在右侧修改文字" : "",
  });
}
