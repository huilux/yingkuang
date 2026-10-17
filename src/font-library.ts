import catalog from "./font-catalog.json";
import retiredFonts from "./retired-fonts.json";
import { fontGlyphCoverage } from "./font-glyphs";
import { textKinds } from "./text-segments";

export function resolveFontFamily(value: string) {
  return [...new Set(value.split(",").map(family => {
    const name = family.trim();
    return (retiredFonts as Record<string, string>)[name] ?? name;
  }))].join(", ");
}

export const builtinFonts = catalog;
export const systemFonts: { value: string; label: string }[] = [];
function renderingFamilies(value: string) {
  const [primary, ...fallbacks] = resolveFontFamily(value).split(", ");
  // Native export uses Long Cang for Chinese and Space Mono for symbols. Put them
  // before generic fallbacks, which could otherwise select a system CJK face.
  return [...new Set([primary, "Long Cang", "Space Mono", ...fallbacks])];
}

// Keep document fonts separate from the application UI's system fonts.
// Saved template names stay stable; only Canvas-facing family names are mapped.
export function previewFontFamily(value: string) {
  return renderingFamilies(value).map(family => {
    const name = family.trim();
    return builtinFonts.some(font => font.family === name) ? `Yingkuang ${name}` : name;
  }).join(", ");
}

const faces = new Map<string, FontFace[]>();
const coverage = new Map<string, ((character: string) => boolean)[]>();
const builtinLoads = new Map<string, Promise<void>>();
let metricsRevision = 0;
export const fontMetricsRevision = () => metricsRevision;

function loadBuiltin(font: typeof builtinFonts[number]) {
  let pending = builtinLoads.get(font.family);
  if (!pending) {
    pending = Promise.all(font.files.map(async file => {
      const response = await fetch(encodeURI(`/fonts/${file.path}`));
      if (!response.ok) throw new Error(`无法加载内置字体 ${font.family}`);
      const bytes = await response.arrayBuffer();
      const hasGlyph = fontGlyphCoverage(bytes);
      const face = new FontFace(`Yingkuang ${font.family}`, bytes, { weight: file.weight });
      await face.load();
      return { face, hasGlyph };
    })).then(loaded => {
      loaded.forEach(({face}) => document.fonts.add(face));
      faces.set(font.family, loaded.map(({face}) => face));
      coverage.set(font.family, loaded.map(({hasGlyph}) => hasGlyph));
      metricsRevision++;
    }).catch(error => { builtinLoads.delete(font.family); throw error; });
    builtinLoads.set(font.family, pending);
  }
  return pending;
}

/** Same primary -> Long Cang -> Space Mono glyph fallback as native export. */
export function previewFontRuns(value: string, text: string) {
  const families = renderingFamilies(value);
  const runs: { family: string; text: string; kind: string }[] = [];
  for (const {character,kind} of textKinds(text)) {
    const family = /^[\t\n\v\f\r ]$/.test(character) ? families[0]
      : families.find(family => coverage.get(family)?.some(hasGlyph => hasGlyph(character))) ?? families[0];
    const previous = runs[runs.length - 1];
    if (previous?.family === family && previous.kind === kind) previous.text += character;
    else runs.push({ family, text: character, kind });
  }
  return runs;
}

/** Canvas text must wait for actual font bytes, including fonts in saved templates. */
export async function ensureFontsLoaded(families: string[]) {
  await restoreImportedFonts();
  const requested = new Set(families.flatMap(renderingFamilies));
  for (const family of requested) {
    if (family.startsWith("YingkuangFont") && !faces.has(family)) throw new Error("缺少自定义字体，请在水印面板重新导入原字体文件");
  }
  await Promise.all([...requested].map(family => {
    const builtin = builtinFonts.find(font => font.family === family);
    return builtin ? loadBuiltin(builtin) : Promise.all((faces.get(family) ?? []).map(face => face.load()));
  }));
}

export interface ImportedFont { family: string; name: string; data: ArrayBuffer }
export interface FontOption { family: string; value: string; label: string }
export const fontsChangedEvent = "yingkuang-fonts-changed";
const isNative = "__TAURI_INTERNALS__" in window;
const maxFontBytes = 32 * 1024 * 1024;
let snapshot: { fonts: FontOption[]; errors: string[]; loading: boolean } = { fonts: [], errors: [], loading: false };
const subscribers = new Set<() => void>();
let restore: Promise<void> | undefined;

export const subscribeFonts = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
export const fontSnapshot = () => snapshot;
function publish(next: typeof snapshot) {
  snapshot = next;
  for (const listener of subscribers) listener();
  window.dispatchEvent(new Event(fontsChangedEvent));
}

async function fontDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("yingkuang-fonts-v1", 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore("fonts", { keyPath: "family" }); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(new Error("无法访问字体库，请检查浏览器存储权限后重试"));
    request.onblocked = () => { blocked = true; reject(new Error("字体库被其他窗口占用，请关闭其他窗口后重试")); };
  });
}

async function readBrowserFonts(): Promise<ImportedFont[]> {
  const db = await fontDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("fonts", "readonly").objectStore("fonts").getAll();
      request.onsuccess = () => resolve(request.result as ImportedFont[]);
      request.onerror = () => reject(new Error("无法读取字体库，请重试加载"));
    });
  } finally { db.close(); }
}

async function saveBrowserFont(font: ImportedFont) {
  const db = await fontDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      tx.objectStore("fonts").put(font);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("字体保存失败，请检查可用存储空间后重新导入"));
    });
  } finally { db.close(); }
}

function nativeFont(font: { family: string; name: string; data: string }): ImportedFont {
  const bytes = Uint8Array.from(atob(font.data), value => value.charCodeAt(0));
  return { ...font, data: bytes.buffer };
}

async function prepareFont(font: ImportedFont) {
  if (!/^YingkuangFont[0-9a-f]{64}$/.test(font.family)) throw new Error("自定义字体标识无效，请重新导入");
  const face = new FontFace(font.family, font.data, { weight: "400 700" });
  await face.load().catch(() => { throw new Error("无法解析字体，请选择有效的 TTF 或 OTF 文件"); });
  return face;
}

function addImportedFont(font: ImportedFont, face: FontFace) {
  const hasGlyph = fontGlyphCoverage(font.data);
  for (const previous of faces.get(font.family) ?? []) document.fonts.delete(previous);
  document.fonts.add(face);
  faces.set(font.family, [face]);
  coverage.set(font.family, [hasGlyph]);
  metricsRevision++;
  const option = { family: font.family, value: `${font.family}, Long Cang, sans-serif`, label: `${font.name} · 已导入` };
  const fonts = [...snapshot.fonts.filter(item => item.family !== font.family), option].sort((a, b) => a.label.localeCompare(b.label));
  publish({ ...snapshot, fonts });
  return option;
}

export function restoreImportedFonts(retry = false) {
  if (retry) restore = undefined;
  return restore ??= Promise.resolve().then(async () => {
    publish({ ...snapshot, loading: true, errors: [] });
    const errors: string[] = [];
    try {
      let fonts: ImportedFont[];
      if (isNative) {
        const { invoke } = await import("@tauri-apps/api/core");
        const report = await invoke<{ fonts: { family: string; name: string; data: string }[]; errors: string[] }>("list_fonts");
        fonts = report.fonts.map(nativeFont);
        errors.push(...report.errors);
      } else fonts = await readBrowserFonts();
      for (const font of fonts) {
        try { addImportedFont(font, await prepareFont(font)); }
        catch (error) { errors.push(`${font.name}：${String(error)}`); }
      }
    } catch (error) { errors.push(String(error)); }
    publish({ ...snapshot, loading: false, errors });
  });
}

export async function importFont(source: File | string): Promise<FontOption> {
  await restoreImportedFonts();
  let font: ImportedFont;
  if (typeof source === "string") {
    const { invoke } = await import("@tauri-apps/api/core");
    font = nativeFont(await invoke<{ family: string; name: string; data: string }>("import_font", { path: source }));
  } else {
    if (!/\.(ttf|otf)$/i.test(source.name)) throw new Error("请选择 TTF 或 OTF 字体文件");
    if (source.size > maxFontBytes) throw new Error("字体文件超过 32 MB，请选择较小的字体文件");
    const data = await source.arrayBuffer();
    const header = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    if (header.join(",") !== "0,1,0,0" && String.fromCharCode(...header) !== "OTTO") throw new Error("请选择有效的 TTF 或 OTF 字体；不支持 TTC、WOFF 或 WOFF2");
    const hash = await crypto.subtle.digest("SHA-256", data);
    const id = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
    font = { family: `YingkuangFont${id}`, name: source.name.replace(/\.[^.]+$/, ""), data };
  }
  const face = await prepareFont(font);
  if (typeof source !== "string") await saveBrowserFont(font);
  return addImportedFont(font, face);
}
