export type FrameType = "blur" | "solid";

export interface PhotoMetadata {
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
  shutter?: string;
  iso?: string;
  capturedAt?: string;
}

export interface PhotoAsset {
  id: string;
  path: string;
  fileName: string;
  width: number;
  height: number;
  megapixels: number;
  thumbnailDataUrl: string;
  metadata: PhotoMetadata;
  overrides?: Partial<Record<MetadataKey, string>>;
}

export interface FrameSettings {
  type: FrameType;
  color: string;
  blur: number;
  brightness: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  shadow: number;
}

export type MetadataKey = keyof PhotoMetadata;
export type LayerSource = MetadataKey | "custom";
export type RegionId = "canvas" | "top" | "bottom" | "left" | "right";

export interface RegionSettings {
  enabled: boolean;
  extra: number;
  safePadding: number;
  direction: 0 | 90 | -90;
}

export interface WatermarkLayer {
  id: string;
  name: string;
  source: LayerSource;
  customValue: string;
  region: RegionId;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  color: string;
  opacity: number;
  rotation: 0 | 90 | -90;
  visible: boolean;
}

export interface EditorDocument {
  version: 1;
  frame: FrameSettings;
  regions: Record<Exclude<RegionId, "canvas">, RegionSettings>;
  layers: WatermarkLayer[];
}

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  cover: string;
  layouts: {
    landscape?: EditorDocument;
    portrait?: EditorDocument;
  };
  updatedAt: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasGeometry {
  width: number;
  height: number;
  photo: Rect;
  regions: Record<RegionId, Rect>;
}

export interface ExportSettings {
  directory: string;
  format: "jpeg" | "png";
  quality: number;
  size: "original" | "long-edge";
  longEdge: number;
  metadata: "none" | "basic" | "supported";
  includeGps: boolean;
  range: "current" | "selected" | "all";
  suffix: string;
  collision: "number" | "skip";
  pngCompression: "fast" | "standard" | "small";
}
