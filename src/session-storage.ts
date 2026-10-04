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
  dimensionsByPath?: Record<string, { width: number; height: number }>;
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
  for (const key of ["documentsByPath", "overridesByPath", "templateIdsByPath", "dimensionsByPath"] as const) {
    const entries = value[key];
    if (entries === undefined) continue;
    if (!record(entries)) throw new Error("工作记录字段不完整");
    for (const entry of Object.values(entries)) {
      if (key === "documentsByPath" && !isValidEditorDocument(entry)) throw new Error("工作记录中的编辑文档无效");
      if (key === "overridesByPath" && (!record(entry) || !Object.values(entry).every(string))) throw new Error("工作记录中的文字覆盖无效");
      if (key === "templateIdsByPath" && !string(entry)) throw new Error("工作记录中的模板关联无效");
      if (key === "dimensionsByPath" && (!record(entry) || ![entry.width, entry.height].every(size => typeof size === "number" && Number.isInteger(size) && size > 0))) throw new Error("工作记录中的照片尺寸无效");
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
    for (const key of ["includeGps", "noUpscale"]) if (settings[key] !== undefined && typeof settings[key] !== "boolean") throw new Error("导出开关设置无效");
  }
  return { ...value, paths: value.paths ?? [] } as SessionSnapshot;
}

export function relocateSessionPath(session: SessionSnapshot, oldPath: string, newPath: string): SessionSnapshot {
  if (!session.paths.includes(oldPath)) throw new Error("原照片已不在当前工作记录中");
  if (!newPath || (newPath !== oldPath && session.paths.includes(newPath))) throw new Error("所选照片已在当前批次中，请选择对应的原图");
  const next = structuredClone(session);
  next.paths = next.paths.map(path => path === oldPath ? newPath : path);
  if (next.activePath === oldPath) next.activePath = newPath;
  if (next.checkedPaths) next.checkedPaths = next.checkedPaths.map(path => path === oldPath ? newPath : path);
  for (const key of ["documentsByPath", "overridesByPath", "templateIdsByPath", "dimensionsByPath"] as const) {
    const entries = next[key];
    if (entries && Object.prototype.hasOwnProperty.call(entries, oldPath) && oldPath !== newPath) {
      Object.defineProperty(entries, newPath, { value: entries[oldPath], enumerable: true, writable: true, configurable: true });
      delete entries[oldPath];
    }
  }
  return next;
}
