import type {
  CanvasGeometry,
  EditorDocument,
  MetadataKey,
  PhotoAsset,
  Rect,
  WatermarkLayer,
} from "./types";
import { builtInDefaultTemplateId, builtInTemplates } from "./builtin-template-catalog.ts";
import { cropPixels } from "./photo-crop.ts";

export { builtInTemplates };

export type MetadataOption = {
  source: MetadataKey | "custom";
  label: string;
  sourceLabel: string;
  value?: string;
};

export const metadataOptions: MetadataOption[] = [
  { source: "camera", label: "相机型号", sourceLabel: "EXIF Make + Model" },
  { source: "make", label: "相机厂商", sourceLabel: "EXIF Make" },
  { source: "model", label: "机身型号", sourceLabel: "EXIF Model" },
  { source: "lens", label: "镜头型号", sourceLabel: "EXIF LensModel / LensSpecification" },
  { source: "focalLength", label: "焦距", sourceLabel: "EXIF FocalLength" },
  { source: "aperture", label: "光圈", sourceLabel: "EXIF FNumber" },
  { source: "shutter", label: "快门", sourceLabel: "EXIF ExposureTime" },
  { source: "iso", label: "ISO", sourceLabel: "EXIF PhotographicSensitivity" },
  { source: "capturedAt", label: "拍摄时间", sourceLabel: "EXIF DateTimeOriginal" },
  { source: "capturedDate", label: "拍摄日期", sourceLabel: "EXIF DateTimeOriginal · 日期" },
  { source: "capturedTime", label: "拍摄时刻", sourceLabel: "EXIF DateTimeOriginal · 时间" },
  { source: "exposureBias", label: "曝光补偿", sourceLabel: "EXIF ExposureBiasValue" },
  { source: "whiteBalance", label: "白平衡", sourceLabel: "EXIF WhiteBalance" },
  { source: "meteringMode", label: "测光模式", sourceLabel: "EXIF MeteringMode" },
  { source: "exposureProgram", label: "曝光模式", sourceLabel: "EXIF ExposureProgram" },
  { source: "focalLength35mm", label: "35mm 等效焦距", sourceLabel: "EXIF FocalLengthIn35mmFilm" },
  { source: "artist", label: "作者", sourceLabel: "EXIF Artist" },
  { source: "copyright", label: "版权", sourceLabel: "EXIF Copyright" },
  { source: "fileName", label: "文件名", sourceLabel: "文件属性 FileName" },
  { source: "dimensions", label: "照片尺寸", sourceLabel: "图像属性 Width × Height" },
  { source: "custom", label: "自定义文字", sourceLabel: "手动输入" },
];

export function formatCapturedAt(value: string): string {
  return value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})(?=\s|$)/, "$1-$2-$3");
}

export function metadataValue(photo: PhotoAsset, source: MetadataKey): string | undefined {
  const direct = photo.metadata[source];
  if (direct) return source === "capturedAt" ? formatCapturedAt(direct) : direct;
  if (source === "fileName") return photo.fileName;
  if (source === "dimensions") return `${photo.width} × ${photo.height}`;
  if (source === "capturedDate" || source === "capturedTime") {
    const capturedAt = photo.metadata.capturedAt;
    if (!capturedAt) return undefined;
    const [date, ...time] = formatCapturedAt(capturedAt).split(/\s+/);
    return source === "capturedDate" ? date : time.join(" ") || undefined;
  }
  return undefined;
}

export function metadataOptionsForPhoto(photo?: PhotoAsset): MetadataOption[] {
  const common = metadataOptions.map(option => option.source === "custom" || !photo
    ? option
    : { ...option, value: metadataValue(photo, option.source) });
  if (!photo) return common;
  const raw = Object.keys(photo.metadata)
    .filter((source): source is `exif:${string}` => source.startsWith("exif:"))
    .sort((left, right) => left.localeCompare(right))
    .map(source => ({
      source,
      label: source.slice(5),
      sourceLabel: `EXIF ${source.slice(5)}`,
      value: photo.metadata[source],
    }));
  return [...common.slice(0, -1), ...raw, common[common.length - 1]!];
}

export function metadataOptionForSource(source: WatermarkLayer["source"]): MetadataOption {
  const known = metadataOptions.find(item => item.source === source);
  if (known) return known;
  const label = source.startsWith("exif:") ? source.slice(5) : source;
  return { source, label, sourceLabel: source.startsWith("exif:") ? `EXIF ${label}` : source };
}

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
    fontFamily: "Space Mono, Long Cang, monospace",
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
  const crop = cropPixels(photo);
  return crop.width >= crop.height ? "landscape" : "portrait";
}

export function resolveLayerText(layer: WatermarkLayer, photo: PhotoAsset): string {
  if (layer.source === "custom") return layer.customValue;
  const override = photo.overrides?.[layer.source];
  const value = override ?? metadataValue(photo, layer.source);
  if (!value?.trim()) return `未读取到${layer.name}`;
  return layer.source === "capturedAt" ? formatCapturedAt(value) : value;
}

export function calculateGeometry(photo: PhotoAsset, document: EditorDocument): CanvasGeometry {
  const crop = cropPixels(photo);
  const ratio = crop.width / crop.height;
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
  const option = metadataOptionForSource(source);
  return layer(`layer-${Date.now()}-${index}`, option?.label ?? "文字", source, 0.5, 0.5, {
    customValue: source === "custom" ? "双击或在右侧修改文字" : "",
  });
}
