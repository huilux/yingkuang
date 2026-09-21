import type {
  CanvasGeometry,
  EditorDocument,
  MetadataKey,
  PhotoAsset,
  Rect,
  RegionId,
  TemplateRecord,
  WatermarkLayer,
} from "./types";

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

const region = (enabled: boolean, extra: number, direction: 0 | 90 | -90 = 0) => ({
  enabled,
  extra,
  safePadding: 2,
  direction,
});

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
  return {
    version: 1,
    frame: {
      type: "blur",
      color: "#f4f4f1",
      blur: 32,
      brightness: 75,
      paddingX: 4,
      paddingY: 4,
      radius: 10,
      shadow: 32,
    },
    regions: {
      top: region(false, 0),
      bottom: region(true, 13),
      left: region(false, 0, -90),
      right: region(false, 0, 90),
    },
    layers: [
      layer("brand", "品牌文字", "custom", 0.13, 0.36, {
        customValue: "LUMIX",
        fontSize: 36,
        fontWeight: 700,
      }),
      layer("camera", "相机型号", "camera", 0.13, 0.69, { fontSize: 16 }),
      layer("focal", "焦距", "focalLength", 0.57, 0.36, { fontSize: 18 }),
      layer("aperture", "光圈", "aperture", 0.67, 0.36, { fontSize: 18 }),
      layer("shutter", "快门", "shutter", 0.78, 0.36, { fontSize: 18 }),
      layer("iso", "ISO", "iso", 0.88, 0.36, { fontSize: 18 }),
      layer("date", "拍摄时间", "capturedAt", 0.73, 0.69, { fontSize: 14 }),
    ],
  };
}

function createWideDocument(): EditorDocument {
  const document = createDefaultDocument();
  document.frame.paddingX = 8;
  document.frame.paddingY = 7;
  document.frame.radius = 18;
  document.frame.shadow = 44;
  document.regions.bottom.extra = 10;
  document.layers = document.layers.map((item) => ({
    ...item,
    y: item.id === "camera" || item.id === "date" ? 0.68 : 0.36,
  }));
  return document;
}

function createSolidDocument(): EditorDocument {
  const document = createDefaultDocument();
  document.frame.type = "solid";
  document.frame.color = "#f7f7f4";
  document.frame.radius = 0;
  document.frame.shadow = 0;
  document.layers = document.layers.map((item) => ({ ...item, color: "#202522" }));
  return document;
}

export function cloneDocument(document: EditorDocument): EditorDocument {
  return structuredClone(document);
}

export function builtInTemplates(): TemplateRecord[] {
  const now = 0;
  return [
    {
      id: "blur-bottom",
      name: "底部信息栏",
      description: "模糊背景，双行参数",
      builtIn: true,
      cover: "/demo.jpg",
      layouts: { landscape: createDefaultDocument(), portrait: createDefaultDocument() },
      updatedAt: now,
    },
    {
      id: "wide-float",
      name: "宽边悬浮",
      description: "宽留白，柔和阴影",
      builtIn: true,
      cover: "/demo.jpg",
      layouts: { landscape: createWideDocument(), portrait: createWideDocument() },
      updatedAt: now,
    },
    {
      id: "solid-white",
      name: "纯白相框",
      description: "白色背景，深色文字",
      builtIn: true,
      cover: "/demo.jpg",
      layouts: { landscape: createSolidDocument(), portrait: createSolidDocument() },
      updatedAt: now,
    },
  ];
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

export function globalToRegion(
  x: number,
  y: number,
  regionId: RegionId,
  geometry: CanvasGeometry,
) {
  const bounds = geometry.regions[regionId];
  return {
    x: Math.max(0, Math.min(1, (x - bounds.x) / Math.max(1, bounds.width))),
    y: Math.max(0, Math.min(1, (y - bounds.y) / Math.max(1, bounds.height))),
  };
}

export function nextLayer(source: WatermarkLayer["source"], index: number): WatermarkLayer {
  const option = metadataOptions.find((item) => item.source === source);
  return layer(`layer-${Date.now()}-${index}`, option?.label ?? "文字", source, 0.5, 0.5, {
    customValue: source === "custom" ? "双击或在右侧修改文字" : "",
  });
}
