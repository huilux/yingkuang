import catalogSource from "./data/builtin-templates.json" with { type: "json" };
import { diffTemplates, type TemplateChange } from "./template-diff.ts";
import type { EditorDocument, TemplateRecord } from "./types";

const catalogFormat = "yingkuang-builtin-templates";
const catalogVersion = 1;

export type BuiltInTemplateCatalog = {
  format: typeof catalogFormat;
  version: typeof catalogVersion;
  defaultTemplateId: string;
  templates: TemplateRecord[];
  contentVersion?: string;
  revision?: number;
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bounded = (value: unknown, maximum: number, minimum = 0): value is number => finite(value) && value >= minimum && value <= maximum;
const color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const knownLayerSources = new Set([
  "camera", "make", "model", "lens", "focalLength", "aperture", "shutter", "iso",
  "capturedAt", "capturedDate", "capturedTime", "exposureBias", "whiteBalance",
  "meteringMode", "exposureProgram", "focalLength35mm", "artist", "copyright",
  "fileName", "dimensions", "custom",
]);
const validLayerSource = (value: unknown): value is string => typeof value === "string" &&
  (knownLayerSources.has(value) || /^exif:[A-Za-z0-9_ ()/.,+:-]{1,120}$/.test(value));

export function isValidEditorDocument(value: unknown): value is EditorDocument {
  if (!record(value) || value.version !== 1 || !record(value.frame) || !record(value.regions) || !Array.isArray(value.layers)) return false;
  const frame = value.frame;
  if ((frame.type !== "blur" && frame.type !== "solid") || !color(frame.color) ||
      !bounded(frame.blur, 200) || !bounded(frame.brightness, 200) || !bounded(frame.paddingX, 100) ||
      !bounded(frame.paddingY, 100) || !bounded(frame.radius, 100) || !bounded(frame.shadow, 100)) return false;
  for (const region of ["top", "bottom", "left", "right"]) {
    const settings = value.regions[region];
    if (!record(settings) || typeof settings.enabled !== "boolean" || !bounded(settings.extra, 100) ||
        !bounded(settings.safePadding, 100) || ![0, 90, -90].includes(settings.direction as number)) return false;
  }
  if (value.layers.length > 100) return false;
  if (new Set(value.layers.map(layer => record(layer) ? layer.id : undefined)).size !== value.layers.length) return false;
  if (value.distributions !== undefined) {
    if (!Array.isArray(value.distributions) || value.distributions.length > 64) return false;
    const used = new Set<string>();
    for (const rule of value.distributions) {
      if (!record(rule) || !["x", "y"].includes(rule.axis as string) || !Array.isArray(rule.layerIds) || rule.layerIds.length < 3 || rule.layerIds.length > 100 || new Set(rule.layerIds).size !== rule.layerIds.length) return false;
      for (const id of rule.layerIds) {
        const key = `${rule.axis}:${id}`;
        if (typeof id !== "string" || !value.layers.some(layer => record(layer) && layer.id === id) || used.has(key)) return false;
        used.add(key);
      }
    }
  }
  return value.layers.every((layer) => record(layer) && text(layer.id, 100) && !!layer.id.trim() && text(layer.name, 120) &&
    validLayerSource(layer.source) &&
    text(layer.customValue, 2000) &&
    ["canvas", "top", "bottom", "left", "right"].includes(layer.region as string) &&
    [layer.x, layer.y].every(value => finite(value) && Number.isFinite(Math.fround(value))) &&
    bounded(layer.fontSize, 1000, 1) && bounded(layer.opacity, 1) &&
    text(layer.fontFamily, 200) && [400, 500, 600, 700].includes(layer.fontWeight as number) &&
    color(layer.color) && [0, 90, -90].includes(layer.rotation as number) && typeof layer.visible === "boolean");
}

export function isValidTemplate(value: unknown): value is TemplateRecord {
  if (!record(value) || !text(value.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.id) || ["__proto__","constructor","prototype"].includes(value.id) ||
      !text(value.name, 120) || !value.name.trim() || !text(value.description, 500) ||
      typeof value.builtIn !== "boolean" || !text(value.cover, 2_000_000) ||
      !(/^\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(value.cover) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.cover)) ||
      !record(value.layouts) || !finite(value.updatedAt)) return false;
  const layouts = value.layouts;
  return (layouts.landscape !== undefined || layouts.portrait !== undefined) &&
    (layouts.landscape === undefined || isValidEditorDocument(layouts.landscape)) &&
    (layouts.portrait === undefined || isValidEditorDocument(layouts.portrait));
}

export function parseBuiltInCatalog(value: unknown): BuiltInTemplateCatalog {
  if (record(value) && value.format === "yingkuang-template-backup") {
    throw new Error("当前文件是“导出备份”生成的完整备份，不能替换内置模板文件。请在模板库使用“导出内置文件”，再替换 src/data/builtin-templates.json。");
  }
  if (!record(value) || value.format !== catalogFormat || value.version !== catalogVersion ||
      !text(value.defaultTemplateId, 100) || !Array.isArray(value.templates) ||
      !value.templates.length || value.templates.length > 100 ||
      !value.templates.every((template) => isValidTemplate(template) && template.builtIn)) {
    throw new Error("内置模板文件格式或模板字段不正确");
  }
  const ids = value.templates.map((template: TemplateRecord) => template.id);
  if ((value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)) ||
    (value.contentVersion !== undefined && (typeof value.contentVersion !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.contentVersion)))) throw new Error("官方模板内容版本无效");
  if (new Set(ids).size !== ids.length || !ids.includes(value.defaultTemplateId)) {
    throw new Error("内置模板 ID 重复或默认模板不存在");
  }
  return value as BuiltInTemplateCatalog;
}

const published = parseBuiltInCatalog(catalogSource);
export const bundledCatalog = (): BuiltInTemplateCatalog => structuredClone(published);

export function builtInTemplates(catalog = published): TemplateRecord[] {
  return structuredClone(catalog.templates);
}

export function builtInDefaultTemplateId(catalog = published): string {
  return catalog.defaultTemplateId;
}

export function builtInTemplateChanges(template: TemplateRecord, catalog = published): TemplateChange[] {
  const original = catalog.templates.find((item) => item.id === template.id);
  return original ? diffTemplates(original, template) : [];
}

export function isBuiltInModified(template: TemplateRecord, catalog = published): boolean {
  return builtInTemplateChanges(template, catalog).length > 0;
}

export function serializeBuiltInCatalog(templates: TemplateRecord[], defaultTemplateId: string, baseline = published): string {
  if (!baseline.templates.some((item) => item.id === defaultTemplateId)) {
    throw new Error("请先将一个内置模板设为新照片默认，再导出内置模板文件");
  }
  const replacements = new Map(templates.map((template) => [template.id, template]));
  const catalog: BuiltInTemplateCatalog = {
    format: catalogFormat,
    version: catalogVersion,
    defaultTemplateId,
    templates: baseline.templates.map((original) => {
      const current = replacements.get(original.id) ?? original;
      return { ...structuredClone(current), id: original.id, builtIn: true, cover: original.cover, updatedAt: 0 };
    }),
  };
  parseBuiltInCatalog(catalog);
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
