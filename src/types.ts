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

export interface ExportSettings {
  directory: string;
  format: "jpeg" | "png";
  quality: number;
  size: "original" | "long-edge";
  longEdge: number;
  metadata: "none" | "basic" | "supported";
  includeGps: boolean;
}
