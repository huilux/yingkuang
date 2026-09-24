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
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function validDocument(value: unknown): value is EditorDocument {
  if (!record(value) || value.version !== 1 || !record(value.frame) || !record(value.regions) || !Array.isArray(value.layers)) return false;
  const frame = value.frame;
  if ((frame.type !== "blur" && frame.type !== "solid") || !text(frame.color, 32) ||
      ![frame.blur, frame.brightness, frame.paddingX, frame.paddingY, frame.radius, frame.shadow].every(finite)) return false;
  for (const region of ["top", "bottom", "left", "right"]) {
    const settings = value.regions[region];
    if (!record(settings) || typeof settings.enabled !== "boolean" || !finite(settings.extra) ||
        !finite(settings.safePadding) || ![0, 90, -90].includes(settings.direction as number)) return false;
  }
  if (value.layers.length > 100) return false;
  return value.layers.every((layer) => record(layer) && text(layer.id, 100) && text(layer.name, 120) &&
    ["camera", "lens", "focalLength", "aperture", "shutter", "iso", "capturedAt", "custom"].includes(layer.source as string) &&
    text(layer.customValue, 2000) &&
    ["canvas", "top", "bottom", "left", "right"].includes(layer.region as string) &&
    [layer.x, layer.y, layer.fontSize, layer.opacity].every(finite) &&
    text(layer.fontFamily, 200) && [400, 500, 600, 700].includes(layer.fontWeight as number) &&
    text(layer.color, 32) && [0, 90, -90].includes(layer.rotation as number) && typeof layer.visible === "boolean");
}

export function isValidTemplate(value: unknown): value is TemplateRecord {
  if (!record(value) || !text(value.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
      !text(value.name, 120) || !value.name.trim() || !text(value.description, 500) ||
      typeof value.builtIn !== "boolean" || !text(value.cover, 2_000_000) ||
      !(/^\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp)$/.test(value.cover) || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.cover)) ||
      !record(value.layouts) || !finite(value.updatedAt)) return false;
  const layouts = value.layouts;
  return (layouts.landscape !== undefined || layouts.portrait !== undefined) &&
    (layouts.landscape === undefined || validDocument(layouts.landscape)) &&
    (layouts.portrait === undefined || validDocument(layouts.portrait));
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
  if (new Set(ids).size !== ids.length || !ids.includes(value.defaultTemplateId)) {
    throw new Error("内置模板 ID 重复或默认模板不存在");
  }
  return value as BuiltInTemplateCatalog;
}

const published = parseBuiltInCatalog(catalogSource);

export function builtInTemplates(): TemplateRecord[] {
  return structuredClone(published.templates);
}

export function builtInDefaultTemplateId(): string {
  return published.defaultTemplateId;
}

export function builtInTemplateChanges(template: TemplateRecord): TemplateChange[] {
  const original = published.templates.find((item) => item.id === template.id);
  return original ? diffTemplates(original, template) : [];
}

export function isBuiltInModified(template: TemplateRecord): boolean {
  return builtInTemplateChanges(template).length > 0;
}

export function serializeBuiltInCatalog(templates: TemplateRecord[], defaultTemplateId: string): string {
  if (!published.templates.some((item) => item.id === defaultTemplateId)) {
    throw new Error("请先将一个内置模板设为新照片默认，再导出内置模板文件");
  }
  const replacements = new Map(templates.map((template) => [template.id, template]));
  const catalog: BuiltInTemplateCatalog = {
    format: catalogFormat,
    version: catalogVersion,
    defaultTemplateId,
    templates: published.templates.map((original) => {
      const current = replacements.get(original.id) ?? original;
      return { ...structuredClone(current), id: original.id, builtIn: true, cover: original.cover, updatedAt: 0 };
    }),
  };
  parseBuiltInCatalog(catalog);
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
