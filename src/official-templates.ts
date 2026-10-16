import { parseBuiltInCatalog } from "./builtin-template-catalog.ts";
import config from "./data/template-update.json" with { type: "json" };
import fonts from "./font-catalog.json" with { type: "json" };
import retired from "./retired-fonts.json" with {type:"json"};
import type {EditorDocument,TemplateRecord} from "./types";

export const officialTemplateConfig = config;
const pick=<T extends object,K extends keyof T>(value:T,keys:readonly K[]):Pick<T,K>=>Object.fromEntries(keys.map(key=>[key,value[key]])) as Pick<T,K>;

/** Author-controlled publication includes only render settings, never photo covers or unknown backup fields. */
export function prepareOfficialCatalog(templates:TemplateRecord[],defaultTemplateId:string,contentVersion:string,revision:number) {
  const document=(source:EditorDocument):EditorDocument=>({
    version:1,
    frame:pick(source.frame,["type","color","blur","brightness","paddingX","paddingY","radius","shadow"]),
    regions:Object.fromEntries((["top","bottom","left","right"] as const).map(region=>[region,pick(source.regions[region],["enabled","extra","safePadding","direction"])])) as EditorDocument["regions"],
    layers:source.layers.map(layer=>({...pick(layer,["id","name","source","customValue","region","x","y","fontFamily","fontSize","fontWeight","color","opacity","rotation","visible"]),
      fontFamily:[...new Set(layer.fontFamily.split(",").map(name=>(retired as Record<string,string>)[name.trim()]??name.trim()))].join(", ")})),
    ...(source.distributions?{distributions:source.distributions.map(rule=>({axis:rule.axis,layerIds:[...rule.layerIds]}))}:{}),
    ...(source.alignments?{alignments:source.alignments.map(rule=>({action:rule.action,reference:rule.reference,layerIds:[...rule.layerIds]}))}:{}),
  });
  const catalog={format:"yingkuang-builtin-templates",version:1,contentVersion,revision,defaultTemplateId,templates:templates.map(template=>({
    ...pick(template,["id","name","description"]),builtIn:true,cover:"/demo.jpg",updatedAt:0,
    layouts:{...(template.layouts.landscape?{landscape:document(template.layouts.landscape)}:{}),...(template.layouts.portrait?{portrait:document(template.layouts.portrait)}:{})},
  }))};
  return parseOfficialCatalog(JSON.stringify(catalog));
}
export type SignedTemplateIndex = { index: string; signature: string };
export type OfficialTemplatePackage = SignedTemplateIndex & { format: "yingkuang-official-template-package"; version: 1; catalog: string };
export type TemplateIndex = { format: "yingkuang-template-feed"; schemaVersion: 1; revision: number; version: string; minAppVersion: string; path: string; sha256: string; bytes: number; templateCount: number; notes: string; fonts: string[] };

export function parseTemplateIndex(source: string): TemplateIndex {
  if (source.length > 16_384) throw new Error("模板更新索引过大");
  const value = JSON.parse(source);
  if (!value || value.format !== "yingkuang-template-feed" || value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    typeof value.version !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.version) ||
    typeof value.minAppVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.minAppVersion) ||
    value.path !== `releases/${value.version}/templates.json` || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 2 * 1024 * 1024 ||
    !Number.isInteger(value.templateCount) || value.templateCount < 1 || value.templateCount > 100 ||
    typeof value.notes !== "string" || value.notes.length > 2000 ||
    !Array.isArray(value.fonts) || value.fonts.length > fonts.length || !value.fonts.every((name: unknown) => fonts.some(font => font.family === name))) throw new Error("模板更新索引格式不正确或软件版本不支持");
  return value;
}

export function parseOfficialCatalog(source: string) {
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw new Error("官方模板包超过 2 MB");
  const catalog = parseBuiltInCatalog(JSON.parse(source));
  const allowed = new Set([...fonts.map(font => font.family), "serif", "sans-serif", "monospace"]);
  for (const template of catalog.templates) {
    if (template.cover !== "/demo.jpg") throw new Error("官方模板不能包含本机照片或外部图片地址");
    for (const layout of Object.values(template.layouts)) for (const layer of layout!.layers) {
      if (layer.fontFamily.split(",").some(name => !allowed.has(name.trim()))) throw new Error("官方模板使用了未随软件提供的字体");
    }
  }
  return catalog;
}

// Native code verifies signatures and hashes before returning these packages.
// The frontend independently validates the entire document schema before use.
export function unpackOfficialTemplates(pack: OfficialTemplatePackage) {
  if (pack?.format !== "yingkuang-official-template-package" || pack.version !== 1 || typeof pack.signature !== "string" || typeof pack.catalog !== "string") throw new Error("不是官方模板更新包");
  const index = parseTemplateIndex(pack.index);
  const catalog = parseOfficialCatalog(pack.catalog);
  if (catalog.revision !== index.revision || catalog.contentVersion !== index.version || catalog.templates.length !== index.templateCount || new TextEncoder().encode(pack.catalog).length !== index.bytes) throw new Error("模板包与更新索引不一致");
  return {index,catalog};
}
