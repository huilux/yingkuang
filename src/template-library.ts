import { builtInTemplates, cloneDocument, photoOrientation } from "./editor-model.ts";
import { builtInDefaultTemplateId, isBuiltInModified, isValidTemplate } from "./builtin-template-catalog.ts";
import type { EditorDocument, PhotoAsset, TemplateRecord } from "./types";

export const templatesKey = "yingkuang-templates-v2";
const legacyTemplatesKey = "yingkuang-templates-v1";
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
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function mergeTemplates(builtIns: TemplateRecord[], overrides: unknown[], custom: unknown[]): TemplateRecord[] {
  const builtInIds = new Set(builtIns.map((template) => template.id));
  const byId = new Map(overrides.filter(isValidTemplate).filter((template) => template.builtIn && builtInIds.has(template.id)).map((template) => [template.id, template]));
  return [
    ...builtIns.map((template) => byId.get(template.id) ?? template),
    ...custom.filter(isValidTemplate).filter((template) => !builtInIds.has(template.id)).map((template) => ({ ...template, builtIn: false })),
  ];
}

export function readTemplates(): TemplateRecord[] {
  const builtIns = builtInTemplates();
  try {
    const stored = localStorage.getItem(templatesKey);
    if (stored) {
      const saved: unknown = JSON.parse(stored);
      if (record(saved) && saved.version === 2 && Array.isArray(saved.overrides) && Array.isArray(saved.custom)) {
        return mergeTemplates(builtIns, saved.overrides, saved.custom);
      }
    }
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyTemplatesKey) ?? "[]");
    if (!Array.isArray(legacy)) return builtIns;
    const valid = legacy.filter(isValidTemplate);
    const builtInIds = new Set(builtIns.map((template) => template.id));
    return mergeTemplates(
      builtIns,
      valid.filter((template) => builtInIds.has(template.id) && template.updatedAt > 0),
      valid.filter((template) => !builtInIds.has(template.id) && (!template.builtIn || template.updatedAt > 0)),
    );
  } catch {
    return builtIns;
  }
}

export function serializeUserTemplates(templates: TemplateRecord[]): string {
  const builtIns = builtInTemplates();
  const builtInIds = new Set(builtIns.map((template) => template.id));
  return JSON.stringify({
    version: 2,
    overrides: templates.filter((template) => builtInIds.has(template.id) && isBuiltInModified(template)),
    custom: templates.filter((template) => !builtInIds.has(template.id)),
  });
}

export function readDefaultTemplateId(templates: TemplateRecord[]): string {
  const stored = localStorage.getItem(defaultTemplateKey);
  return templates.some((template) => template.id === stored) ? stored! : builtInDefaultTemplateId();
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
  if (!value.templates.every(isValidTemplate)) throw new Error("备份中的模板字段不完整或格式不正确");
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
