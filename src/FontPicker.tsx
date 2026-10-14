import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { SelectControl } from "./SelectControl";
import { builtinFonts, fontSnapshot, importFont, restoreImportedFonts, resolveFontFamily, subscribeFonts, systemFonts } from "./font-library";

const isNative = "__TAURI_INTERNALS__" in window;

export function FontPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const library = useSyncExternalStore(subscribeFonts, fontSnapshot);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const options = [...builtinFonts, ...library.fonts, ...systemFonts];
  const selectedValue = options.find(font =>
    resolveFontFamily(font.value).split(",")[0] === resolveFontFamily(value).split(",")[0]
  )?.value ?? value;
  const known = !selectedValue || options.some(font => font.value === selectedValue);
  useEffect(() => { alive.current = true; void restoreImportedFonts(); return () => { alive.current = false; }; }, []);

  async function importSources(sources: Array<File | string>) {
    if (!sources.length) return;
    setBusy(true); setFeedback(""); setFailed(false);
    const imported: string[] = [], errors: string[] = [];
    for (const source of sources) {
      try { imported.push((await importFont(source)).label.replace(/ · 已导入$/, "")); }
      catch (error) { errors.push(`${typeof source === "string" ? source.split(/[\\/]/).pop() : source.name}：${String(error)}`); }
    }
    if (!alive.current) return;
    // Import adds to the library; choosing a face remains an explicit edit, so
    // selection changes during a long import cannot patch the wrong layers.
    setFailed(errors.length > 0);
    setFeedback([imported.length ? `已导入 ${imported.length} 个字体，可在上方列表选择。` : "", ...errors].filter(Boolean).join("\n"));
    setBusy(false);
  }

  async function chooseFiles() {
    if (!isNative) { fileInput.current?.click(); return; }
    setBusy(true); setFeedback(""); setFailed(false);
    try {
      const selection = await open({ multiple: true, directory: false, filters: [{ name: "字体文件", extensions: ["ttf", "otf"].flatMap(extension =>
        Array.from({ length: 8 }, (_, mask) => [...extension].map((letter, index) => mask & (1 << index) ? letter.toUpperCase() : letter).join(""))) }] });
      if (selection && alive.current) await importSources(Array.isArray(selection) ? selection : [selection]);
    } catch (error) { if (alive.current) { setFeedback(String(error)); setFailed(true); } }
    finally { if (alive.current) setBusy(false); }
  }

  return <div className="font-picker" aria-busy={busy || library.loading}>
    <label className="field"><span>字体</span><SelectControl aria-label="字体" value={selectedValue} onChange={event => onChange(event.currentTarget.value)}>
      {!value && <option value="" disabled>多种字体</option>}
      {!known && <option value={value} disabled>{value.startsWith("YingkuangFont") ? "自定义字体（缺失，请重新导入）" : resolveFontFamily(value) !== value ? `${resolveFontFamily(value)}（旧字体已替换）` : `${value}（模板字体）`}</option>}
      {options.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
    </SelectControl></label>
    <button className="font-import-button" type="button" disabled={busy || library.loading} onClick={() => void chooseFiles()}><UploadSimple aria-hidden="true" />{busy ? "正在导入字体…" : library.loading ? "正在加载字体库…" : "导入字体"}</button>
    <input ref={fileInput} type="file" accept=".ttf,.otf" multiple hidden aria-label="导入字体文件" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void importSources(files); }} />
    <p className="selection-note">支持 TTF / OTF，每个文件最多 32 MB。导入后保存在本机，重启仍可使用。</p>
    {feedback && <p className="font-feedback" role={failed ? "alert" : "status"}>{feedback}</p>}
    {!!library.errors.length && <div className="font-feedback" role="alert"><p>{library.errors.join("\n")}</p><button type="button" className="restore-field" disabled={busy || library.loading} onClick={() => void restoreImportedFonts(true)}>重试加载字体库</button></div>}
  </div>;
}
