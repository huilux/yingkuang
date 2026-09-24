import type { EditorDocument, ExportSettings, PhotoAsset } from "./types";

export type ExportIssueField = "range" | "directory" | "longEdge" | "suffix" | "quality" | "preflight";

export type ExportIssue = {
  field: ExportIssueField;
  message: string;
};

export type ExportItem = {
  path: string;
  document: EditorDocument;
  overrides: NonNullable<PhotoAsset["overrides"]>;
};

export type ExportPlan = {
  items: ExportItem[];
  issues: ExportIssue[];
  sampleFileName: string;
  sampleDimensions: string;
  estimatedPixels: number;
};

type BuildExportPlanInput = {
  photos: PhotoAsset[];
  documents: Record<string, EditorDocument>;
  activeId: string;
  checkedIds: string[];
  settings: ExportSettings;
  retryPaths?: Set<string>;
};

function outputDimensions(photo: PhotoAsset, document: EditorDocument, settings: ExportSettings) {
  const ratio = photo.width / photo.height;
  const photoWidth = ratio >= 1 ? ratio * 1000 : 1000;
  const photoHeight = ratio >= 1 ? 1000 : 1000 / ratio;
  const horizontal = document.frame.paddingX * 10;
  const vertical = document.frame.paddingY * 10;
  const width = photoWidth + horizontal * 2
    + (document.regions.left.enabled ? document.regions.left.extra * 10 : 0)
    + (document.regions.right.enabled ? document.regions.right.extra * 10 : 0);
  const height = photoHeight + vertical * 2
    + (document.regions.top.enabled ? document.regions.top.extra * 10 : 0)
    + (document.regions.bottom.enabled ? document.regions.bottom.extra * 10 : 0);
  const scale = settings.size === "long-edge"
    ? settings.longEdge / Math.max(width, height)
    : photo.width / photoWidth;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function selectedIds(input: BuildExportPlanInput) {
  if (input.settings.range === "current") return input.activeId ? [input.activeId] : [];
  if (input.settings.range === "all") return input.photos.map((photo) => photo.id);
  return input.checkedIds;
}

function validate(settings: ExportSettings, itemCount: number): ExportIssue[] {
  const issues: ExportIssue[] = [];
  if (itemCount === 0) issues.push({ field: "range", message: "当前范围没有可导出的本地照片" });
  if (!settings.directory.trim()) issues.push({ field: "directory", message: "请选择输出文件夹" });
  if (settings.size === "long-edge" && (!Number.isInteger(settings.longEdge) || settings.longEdge < 800 || settings.longEdge > 30000)) {
    issues.push({ field: "longEdge", message: "成品长边须为 800–30000 之间的整数" });
  }
  if ([...settings.suffix].length > 80 || /[<>:"/\\|?*\u0000-\u001f]/u.test(settings.suffix)) {
    issues.push({ field: "suffix", message: "文件名后缀不能包含路径或系统保留字符，且最多 80 个字符" });
  }
  if (!Number.isInteger(settings.quality) || settings.quality < 1 || settings.quality > 100) {
    issues.push({ field: "quality", message: "JPEG 质量须为 1–100 之间的整数" });
  }
  return issues;
}

export function buildExportPlan(input: BuildExportPlanInput): ExportPlan {
  const byId = new Map(input.photos.map((photo) => [photo.id, photo]));
  const uniqueIds = [...new Set(selectedIds(input))];
  const selectedPhotos = uniqueIds.flatMap((id) => {
    const photo = byId.get(id);
    const document = input.documents[id];
    if (!photo || !document || (input.retryPaths && !input.retryPaths.has(photo.path))) return [];
    return [{ photo, document }];
  });
  const items = selectedPhotos.map(({ photo, document }) => ({
    path: photo.path,
    document: structuredClone(document),
    overrides: structuredClone(photo.overrides ?? {}),
  }));
  const issues = validate(input.settings, items.length);
  const sample = selectedPhotos[0];
  const extension = input.settings.format === "png" ? "png" : "jpg";
  const stem = sample?.photo.fileName.replace(/\.[^.]+$/u, "") || "照片";
  const dimensions = sample ? outputDimensions(sample.photo, sample.document, input.settings) : null;
  const estimatedPixels = selectedPhotos.reduce((total, { photo, document }) => {
    const output = outputDimensions(photo, document, input.settings);
    return total + output.width * output.height;
  }, 0);
  return {
    items,
    issues,
    sampleFileName: `${stem}${input.settings.suffix}.${extension}`,
    sampleDimensions: dimensions ? `${dimensions.width} × ${dimensions.height}` : "",
    estimatedPixels,
  };
}
