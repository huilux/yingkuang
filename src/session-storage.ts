import { isValidEditorDocument } from "./builtin-template-catalog.ts";
import type { EditorDocument, ExportSettings, PhotoAsset } from "./types";

export type SessionSnapshot = {
  paths: string[];
  activePath?: string;
  checkedPaths?: string[];
  documentsByPath?: Record<string, EditorDocument>;
  overridesByPath?: Record<string, PhotoAsset["overrides"]>;
  exportSettings?: Partial<ExportSettings>;
  activeTemplate?: string;
  templateIdsByPath?: Record<string, string>;
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);

export function parseSession(source: string | null): SessionSnapshot {
  const value: unknown = JSON.parse(source ?? "{}");
  if (!record(value) || (value.paths !== undefined && !strings(value.paths)) ||
      (value.checkedPaths !== undefined && !strings(value.checkedPaths)) ||
      (value.activePath !== undefined && !string(value.activePath)) ||
      (value.activeTemplate !== undefined && !string(value.activeTemplate))) throw new Error("工作记录格式不正确");
  for (const key of ["documentsByPath", "overridesByPath", "templateIdsByPath"] as const) {
    const entries = value[key];
    if (entries === undefined) continue;
    if (!record(entries)) throw new Error("工作记录字段不完整");
    for (const entry of Object.values(entries)) {
      if (key === "documentsByPath" && !isValidEditorDocument(entry)) throw new Error("工作记录中的编辑文档无效");
      if (key === "overridesByPath" && (!record(entry) || !Object.values(entry).every(string))) throw new Error("工作记录中的文字覆盖无效");
      if (key === "templateIdsByPath" && !string(entry)) throw new Error("工作记录中的模板关联无效");
    }
  }
  if (value.exportSettings !== undefined) {
    if (!record(value.exportSettings)) throw new Error("导出设置格式不正确");
    const settings = value.exportSettings;
    const enums: Record<string, string[]> = {
      format: ["jpeg", "png"], size: ["original", "long-edge"], metadata: ["none", "basic", "supported"],
      range: ["current", "selected", "all"], collision: ["number", "skip"], pngCompression: ["fast", "standard", "small"],
    };
    for (const [key, choices] of Object.entries(enums)) {
      if (settings[key] !== undefined && !choices.includes(settings[key] as string)) throw new Error("导出设置包含不支持的选项");
    }
    for (const key of ["directory", "suffix"]) if (settings[key] !== undefined && !string(settings[key])) throw new Error("导出路径或后缀无效");
    for (const key of ["quality", "longEdge"]) if (settings[key] !== undefined && (typeof settings[key] !== "number" || !Number.isFinite(settings[key]))) throw new Error("导出尺寸或质量无效");
    if (settings.includeGps !== undefined && typeof settings.includeGps !== "boolean") throw new Error("元数据设置无效");
  }
  return { ...value, paths: value.paths ?? [] } as SessionSnapshot;
}
