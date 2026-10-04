export type FrameType = "blur" | "solid";

export type KnownMetadataKey =
  | "camera"
  | "make"
  | "model"
  | "lens"
  | "focalLength"
  | "aperture"
  | "shutter"
  | "iso"
  | "capturedAt"
  | "capturedDate"
  | "capturedTime"
  | "exposureBias"
  | "whiteBalance"
  | "meteringMode"
  | "exposureProgram"
  | "focalLength35mm"
  | "artist"
  | "copyright"
  | "fileName"
  | "dimensions";

export type MetadataKey = KnownMetadataKey | `exif:${string}`;
export type PhotoMetadata = Partial<Record<MetadataKey, string>>;

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
  noUpscale: boolean;
  metadata: "none" | "basic" | "supported";
  includeGps: boolean;
  range: "current" | "selected" | "all";
  suffix: string;
  collision: "number" | "skip";
  pngCompression: "fast" | "standard" | "small";
}

export interface ExportProgress {
  current: number;
  completed: number;
  total: number;
  fileName: string;
  succeeded: number;
  failed: number;
  skipped: number;
  stage: "preflight" | "preparing" | "rendering" | "encoding" | "metadata" | "finishing" | "completed-item";
}

export interface ExportSummary {
  elapsedMs: number;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  outputDirectory: string;
  failures: Array<{ fileName: string; path: string; reason: string }>;
  warnings: string[];
}

export interface ExportPreflight {
  ready: boolean;
  total: number;
  estimatedPixels: number;
  largestWidth: number;
  largestHeight: number;
  largestFileName: string;
  errors: string[];
  warnings: string[];
}
