import { builtInTemplates, cloneDocument, photoOrientation } from "./editor-model.ts";
import { bundledCatalog, parseBuiltInCatalog, builtInDefaultTemplateId, isBuiltInModified, isValidTemplate, type BuiltInTemplateCatalog } from "./builtin-template-catalog.ts";
import type { EditorDocument, PhotoAsset, TemplateRecord } from "./types";
import {appendTemplateReferenceMigration,validTemplateReferenceMigrations,type TemplateReferenceMigration} from "./template-references.ts";

export const templatesKey = "yingkuang-templates-v3";
const previousTemplatesKey = "yingkuang-templates-v2";
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

export const maxTemplateNameLength = 120;

export function templateNameError(name: string, templates: TemplateRecord[], exceptId?: string): string {
  const normalized = name.trim();
  if (!normalized) return "模板名称不能为空";
  if (normalized.length > maxTemplateNameLength) return "模板名称最多 120 个字符";
  if (templates.some(template => template.id !== exceptId && template.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    return "已有同名模板，请换一个名称";
  }
  return "";
}

export function copyTemplateName(name: string, templates: TemplateRecord[]): string {
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? " 副本" : ` 副本 ${number}`;
    let prefix = "";
    for (const character of name.trim()) {
      if (prefix.length + character.length + suffix.length > maxTemplateNameLength) break;
      prefix += character;
    }
    const candidate = prefix.trimEnd() + suffix;
    if (!templates.some(template => template.name.trim().toLocaleLowerCase() === candidate.toLocaleLowerCase())) return candidate;
  }
}

function mergeTemplates(builtIns: TemplateRecord[], overrides: unknown[], custom: unknown[]): TemplateRecord[] {
  const builtInIds = new Set(builtIns.map((template) => template.id));
  const byId = new Map(overrides.filter(isValidTemplate).filter((template) => template.builtIn && builtInIds.has(template.id)).map((template) => [template.id, template]));
  const customById = new Map(custom.filter(isValidTemplate).filter(template => !builtInIds.has(template.id)).map(template => [template.id, { ...template, builtIn: false }]));
  return [
    ...builtIns.map((template) => byId.get(template.id) ?? template),
    ...customById.values(),
  ];
}

export type OverrideBases = Record<string, TemplateRecord>;
export type TemplateLibrary = { templates: TemplateRecord[]; canPersist: boolean; issue: string; catalog: BuiltInTemplateCatalog; overrideBases: OverrideBases; referenceMap:Record<string,string>;referenceMigrations:TemplateReferenceMigration[] };

export function readTemplateLibrary(): TemplateLibrary {
  let catalog = bundledCatalog();
  let overrideBases: OverrideBases = {};
  let referenceMap:Record<string,string> = {};
  let referenceMigrations:TemplateReferenceMigration[] = [];
  const legacyTemplates=(overrides:TemplateRecord[],custom:TemplateRecord[])=>{
    const personalIds=new Set(custom.map(template=>template.id));
    const previous={...catalog,templates:catalog.templates.filter(template=>!personalIds.has(template.id))};
    const migrated=rebaseTemplateLibrary(mergeTemplates(previous.templates,overrides,custom),previous,catalog,overrideBases);
    overrideBases=migrated.overrideBases;referenceMap=migrated.idMap;
    referenceMigrations=appendTemplateReferenceMigration(referenceMigrations,migrated.idMap);
    return migrated.templates;
  };
  const result = (templates: TemplateRecord[], valid: boolean) => {
    const bundled = bundledCatalog();
    if(valid && (catalog.revision ?? 0) < (bundled.revision ?? 0)) {
      const updated=rebaseTemplateLibrary(templates,catalog,bundled,overrideBases);
      templates=updated.templates;overrideBases=updated.overrideBases;catalog=bundled;referenceMap={...referenceMap,...updated.idMap};
      referenceMigrations=appendTemplateReferenceMigration(referenceMigrations,updated.idMap);
    }
    return { templates, canPersist: valid, catalog, overrideBases,referenceMap,referenceMigrations,
      issue: valid ? "" : "模板库包含无法读取的内容，原始记录已保留；本次模板修改请导出备份保存。" };
  };
  try {
    const stored = localStorage.getItem(templatesKey) ?? localStorage.getItem(previousTemplatesKey);
    if (stored) {
      const saved: unknown = JSON.parse(stored);
      if (!record(saved) || ![2,3].includes(saved.version as number) || !Array.isArray(saved.overrides) || !Array.isArray(saved.custom)) return result(catalog.templates, false);
      if (saved.version === 3) {
        catalog = parseBuiltInCatalog(saved.catalog);
        if (!record(saved.overrideBases) || !Object.entries(saved.overrideBases).every(([id,base]) => isValidTemplate(base) && base.id === id && base.builtIn)) return result(catalog.templates, false);
        overrideBases = saved.overrideBases as OverrideBases;
        const migrations=saved.referenceMigrations ?? (saved.referenceMap!==undefined?[{epoch:1,ids:saved.referenceMap}]:[]);
        if(!validTemplateReferenceMigrations(migrations))return result(catalog.templates,false);
        referenceMigrations=migrations;
      }
      const builtIns = builtInTemplates(catalog);
      const entries = [...saved.overrides, ...saved.custom];
      const savedOverrides = saved.overrides;
      const builtInIds = new Set(builtIns.map(template => template.id));
      if(saved.version===3 && saved.defaultTemplateId!==undefined && (!text(saved.defaultTemplateId,100) || (!builtInIds.has(saved.defaultTemplateId) && !entries.some(template=>isValidTemplate(template) && template.id===saved.defaultTemplateId))))return result(mergeTemplates(builtIns,saved.overrides,saved.custom),false);
      const valid = saved.overrides.every(template => isValidTemplate(template) && template.builtIn && builtInIds.has(template.id)) &&
        saved.custom.every(template => isValidTemplate(template) && !template.builtIn && (saved.version===2 || !builtInIds.has(template.id))) &&
        new Set(entries.map(template => template.id)).size === entries.length;
      if (valid && saved.version === 2) overrideBases = Object.fromEntries(saved.overrides.map(template => [template.id, structuredClone(builtIns.find(base => base.id === template.id)!)]));
      if(valid && saved.version===2)return result(legacyTemplates(saved.overrides,saved.custom),true);
      const basesValid = saved.version !== 3 || Object.keys(overrideBases).every(id => savedOverrides.some((template: TemplateRecord) => template.id === id)) && savedOverrides.every((template: TemplateRecord) => overrideBases[template.id]);
      return result(mergeTemplates(builtIns, saved.overrides, saved.custom), valid && !!basesValid);
    }
    const builtIns = builtInTemplates(catalog);
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyTemplatesKey) ?? "[]");
    if (!Array.isArray(legacy)) return result(builtIns, false);
    const valid = legacy.filter(isValidTemplate);
    const builtInIds = new Set(builtIns.map(template => template.id));
    const canPersist=valid.length === legacy.length && new Set(valid.map(template => template.id)).size === valid.length;
    const overrides=valid.filter(template=>template.builtIn && builtInIds.has(template.id) && template.updatedAt>0);
    const custom=valid.filter(template=>!template.builtIn || !builtInIds.has(template.id)).map(template=>({...template,builtIn:false}));
    return result(canPersist?legacyTemplates(overrides,custom):mergeTemplates(builtIns,overrides,custom),canPersist);
  } catch { return result(builtInTemplates(catalog), false); }
}

export function readTemplates(): TemplateRecord[] {
  return readTemplateLibrary().templates;
}

export function serializeUserTemplates(templates: TemplateRecord[], catalog = bundledCatalog(), bases: OverrideBases = {}, defaultTemplateId?:string,referenceMigrations:TemplateReferenceMigration[]=[]): string {
  if(!validTemplateReferenceMigrations(referenceMigrations))throw new Error("模板引用迁移记录无效，未覆盖已保存的模板库");
  if (!templates.every(isValidTemplate)) throw new Error("模板字段不完整或超出支持范围，未覆盖已保存的模板库");
  if (new Set(templates.map(template => template.id)).size !== templates.length) throw new Error("模板 ID 重复，未覆盖已保存的模板库");
  if(defaultTemplateId!==undefined && !templates.some(template=>template.id===defaultTemplateId))throw new Error("默认模板不存在，未覆盖已保存的模板库");
  const builtIns = builtInTemplates(catalog);
  const builtInIds = new Set(builtIns.map((template) => template.id));
  if (templates.some(template => template.builtIn !== builtInIds.has(template.id))) throw new Error("官方模板与个人模板 ID 冲突，未覆盖已保存的模板库");
  const overrides = templates.filter(template => template.builtIn && builtInIds.has(template.id) && (bases[template.id] || isBuiltInModified(template,catalog)));
  return JSON.stringify({
    version: 3,
    catalog,
    defaultTemplateId,
    referenceMigrations,
    overrideBases: Object.fromEntries(overrides.map(template => [template.id, bases[template.id] ?? builtIns.find(base => base.id === template.id)!])),
    overrides,
    custom: templates.filter((template) => !template.builtIn && !builtInIds.has(template.id)),
  });
}

// Update only the official baseline. Edited/retired records and personal ID
// collisions remain recoverable; callers remap references using idMap.
export function rebaseTemplateLibrary(templates: TemplateRecord[], previous: BuiltInTemplateCatalog, next: BuiltInTemplateCatalog, bases: OverrideBases = {}) {
  parseBuiltInCatalog(next);
  const ids = new Set([...next.templates, ...templates].map(template => template.id));
  const official = new Map(next.templates.map(template => [template.id,structuredClone(template)]));
  const custom: TemplateRecord[] = [];
  const overrideBases: OverrideBases = {};
  const idMap: Record<string,string> = {};
  for (const template of templates) {
    if (template.builtIn) {
      if (!official.has(template.id)) custom.push({...structuredClone(template),builtIn:false});
      else if (bases[template.id] || isBuiltInModified(template,previous)) {
        official.set(template.id,structuredClone(template));
        overrideBases[template.id] = structuredClone(bases[template.id] ?? previous.templates.find(base => base.id === template.id) ?? template);
      }
    } else {
      const copy = structuredClone(template);
      if (official.has(copy.id)) {
        const prefix = `local-${copy.id}`.slice(0,90);
        let id = prefix, counter = 1;
        while(ids.has(id)) id = `${prefix}-${counter++}`;
        ids.add(id);idMap[copy.id] = id;copy.id = id;
      }
      custom.push(copy);
    }
  }
  return {templates:[...official.values(),...custom],overrideBases,idMap};
}

export function resolveTemplateReference(id:string,references:Record<string,string>) {
  const seen=new Set<string>();
  while(references[id] && !seen.has(id)){seen.add(id);id=references[id];}
  return id;
}

export function readDefaultTemplateId(templates: TemplateRecord[], catalog = bundledCatalog(),referenceMap:Record<string,string>={}): string {
  try {
    const saved=JSON.parse(localStorage.getItem(templatesKey)??"null");
    const snapshotDefault=typeof saved?.defaultTemplateId==="string"?resolveTemplateReference(saved.defaultTemplateId,referenceMap):undefined;
    if(saved?.version===3 && typeof snapshotDefault==="string" && templates.some(template=>template.id===snapshotDefault))return snapshotDefault;
    const stored = localStorage.getItem(defaultTemplateKey);
    const id=stored?resolveTemplateReference(stored,referenceMap):null;
    return templates.some((template) => template.id === id) ? id! : builtInDefaultTemplateId(catalog);
  } catch { return builtInDefaultTemplateId(catalog); }
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
  const invalidIndex = value.templates.findIndex(template => !isValidTemplate(template));
  if (invalidIndex >= 0) throw new Error(`备份中第 ${invalidIndex + 1} 个模板的字段不完整、重复或超出支持范围`);
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
        incoming.name = copyTemplateName(incoming.name, next);
      }
      incoming.builtIn = false;
      next.push(incoming);
      idMap[template.id] = incoming.id;
    }
    imported++;
  }
  return { templates: next, imported, idMap };
}
