import { builtInTemplates, cloneDocument, photoOrientation } from "./editor-model.ts";
import type { EditorDocument, PhotoAsset, TemplateRecord } from "./types";

export const templatesKey = "yingkuang-templates-v1";
export const defaultTemplateKey = "yingkuang-default-template-v1";
const backupFormat = "yingkuang-template-backup";
const backupVersion = 1;

export type TemplateBackup = {
  format: typeof backupFormat;
  version: typeof backupVersion;
  exportedAt: string;
  defaultTemplateId: string;
  templates: TemplateRecord[];
};

export type ImportChoice = "overwrite" | "copy" | "skip";
export type ImportDecision = { template: TemplateRecord; conflictId?: string; choice: ImportChoice };

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

function validTemplate(value: unknown): value is TemplateRecord {
  if (!record(value) || !text(value.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
      !text(value.name, 120) || !value.name.trim() || !text(value.description, 500) ||
      typeof value.builtIn !== "boolean" || !text(value.cover, 2_000_000) ||
      !(value.cover === "/demo.jpg" || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.cover)) ||
      !record(value.layouts) || !finite(value.updatedAt)) return false;
  const layouts = value.layouts;
  return (layouts.landscape !== undefined || layouts.portrait !== undefined) &&
    (layouts.landscape === undefined || validDocument(layouts.landscape)) &&
    (layouts.portrait === undefined || validDocument(layouts.portrait));
}

export function readTemplates(): TemplateRecord[] {
  const builtIns = builtInTemplates();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(templatesKey) ?? "[]");
    if (!Array.isArray(saved)) return builtIns;
    const valid = saved.filter(validTemplate);
    const byId = new Map(valid.map((item) => [item.id, item]));
    return [...builtIns.map((item) => byId.get(item.id) ?? item), ...valid.filter((item) => !builtIns.some((builtIn) => builtIn.id === item.id))];
  } catch {
    return builtIns;
  }
}

export function readDefaultTemplateId(templates: TemplateRecord[]): string {
  const stored = localStorage.getItem(defaultTemplateKey);
  return templates.some((template) => template.id === stored) ? stored! : "blur-bottom";
}

export function documentFromTemplate(template: TemplateRecord, photo: PhotoAsset): EditorDocument {
  const orientation = photoOrientation(photo);
  const layout = template.layouts[orientation] ?? template.layouts.landscape ?? template.layouts.portrait;
  if (!layout) throw new Error(`模板“${template.name}”没有可用布局`);
  return cloneDocument(layout);
}

export function serializeTemplateBackup(templates: TemplateRecord[], defaultTemplateId: string): string {
  const backup: TemplateBackup = {
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    defaultTemplateId,
    templates,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseTemplateBackup(source: string): TemplateBackup {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("备份文件不是有效的 JSON"); }
  if (!record(value) || value.format !== backupFormat || value.version !== backupVersion ||
      !Array.isArray(value.templates) || !text(value.defaultTemplateId, 100) ||
      !text(value.exportedAt, 100) || value.templates.length > 500) {
    throw new Error("文件不是受支持的映框模板备份");
  }
  if (!value.templates.every(validTemplate)) throw new Error("备份中的模板字段不完整或格式不正确");
  const ids = value.templates.map((item: TemplateRecord) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("备份中存在重复的模板 ID");
  if (value.defaultTemplateId && !ids.includes(value.defaultTemplateId)) throw new Error("备份中的默认模板不存在");
  return value as TemplateBackup;
}

export function findTemplateConflict(existing: TemplateRecord[], incoming: TemplateRecord): TemplateRecord | undefined {
  return existing.find((item) => item.id === incoming.id) ??
    existing.find((item) => item.name.trim().toLocaleLowerCase() === incoming.name.trim().toLocaleLowerCase());
}

export function importTemplates(existing: TemplateRecord[], decisions: ImportDecision[]): { templates: TemplateRecord[]; imported: number; idMap: Record<string, string> } {
  const next = [...existing];
  let imported = 0;
  const idMap: Record<string, string> = Object.create(null);
  for (const { template, conflictId, choice } of decisions) {
    if (choice === "skip") {
      if (conflictId) idMap[template.id] = conflictId;
      continue;
    }
    const incoming = structuredClone(template);
    if (choice === "overwrite" && conflictId) {
      const index = next.findIndex((item) => item.id === conflictId);
      if (index < 0) continue;
      next[index] = { ...incoming, id: conflictId, builtIn: next[index].builtIn };
      idMap[template.id] = conflictId;
    } else {
      incoming.id = (conflictId || next.some((item) => item.id === incoming.id)) ? `template-${crypto.randomUUID()}` : incoming.id;
      if (conflictId) {
        const base = `${incoming.name} 副本`;
        let name = base;
        let suffix = 2;
        while (next.some((item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base} ${suffix++}`;
        incoming.name = name;
      }
      incoming.builtIn = false;
      next.push(incoming);
      idMap[template.id] = incoming.id;
    }
    imported++;
  }
  return { templates: next, imported, idMap };
}
