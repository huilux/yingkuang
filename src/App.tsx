import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  CaretDown,
  Check,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  FloppyDisk,
  FolderSimple,
  FolderOpen,
  FrameCorners,
  ImageSquare,
  Plus,
  TextT,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { EditorWorkspace } from "./EditorWorkspace";
import {
  builtInTemplates,
  calculateGeometry,
  cloneDocument,
  createDefaultDocument,
  metadataOptions,
  nextLayer,
  photoOrientation,
  resolveLayerText,
} from "./editor-model";
import type {
  EditorDocument,
  ExportSettings,
  LayerSource,
  PhotoAsset,
  RegionId,
  TemplateRecord,
  WatermarkLayer,
} from "./types";
import "./App.css";

const isNative = "__TAURI_INTERNALS__" in window;
const sessionKey = "yingkuang-session-v2";
const templatesKey = "yingkuang-templates-v1";

const demoPhoto: PhotoAsset = {
  id: "demo-pana9448",
  path: "",
  fileName: "PANA9448.JPG",
  width: 6000,
  height: 4000,
  megapixels: 24,
  thumbnailDataUrl: "/demo.jpg",
  metadata: {
    camera: "LUMIX DC-S5M2",
    lens: "LUMIX S 50mm F1.8",
    focalLength: "50mm",
    aperture: "f/2.8",
    shutter: "1/1600s",
    iso: "ISO100",
    capturedAt: "2026:08:22",
  },
};

const defaultExport: ExportSettings = {
  directory: "",
  format: "jpeg",
  quality: 92,
  size: "original",
  longEdge: 6000,
  metadata: "basic",
  includeGps: false,
  range: "selected",
  suffix: "-相框",
  collision: "number",
  pngCompression: "standard",
};

type LoadState = "idle" | "loading" | "error";
type InspectorTab = "frame" | "watermark";
type Orientation = "landscape" | "portrait";

type ExportProgress = {
  current: number;
  total: number;
  fileName: string;
  succeeded: number;
  failed: number;
  skipped: number;
  stage: string;
};

type ExportSummary = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  outputDirectory: string;
  failures: Array<{ fileName: string; path: string; reason: string }>;
  warnings: string[];
};

type InspectReport = {
  items: PhotoAsset[];
  failures: Array<{ path: string; reason: string }>;
};

const regionLabels: Record<Exclude<RegionId, "canvas">, string> = {
  top: "上",
  bottom: "下",
  left: "左",
  right: "右",
};

function readTemplates() {
  const builtIns = builtInTemplates();
  try {
    const saved = JSON.parse(localStorage.getItem(templatesKey) ?? "[]") as TemplateRecord[];
    const savedById = new Map(saved.map((item) => [item.id, item]));
    const merged = builtIns.map((item) => savedById.get(item.id) ?? item);
    return [...merged, ...saved.filter((item) => !builtIns.some((builtIn) => builtIn.id === item.id))];
  } catch {
    return builtIns;
  }
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  onStart,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <label className="field slider-field">
      <span className="field-heading"><span>{label}</span><output>{value}{suffix}</output></span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="field segmented-field">
      <legend>{label}</legend>
      <div className="segmented">
        {options.map((option) => (
          <button className={value === option.value ? "selected" : ""} key={option.value} type="button" onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function formatPixels(photo: PhotoAsset) {
  return `${photo.width} × ${photo.height}`;
}

function initialDocuments() {
  return isNative ? {} : { [demoPhoto.id]: createDefaultDocument() };
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const transactionStart = useRef<EditorDocument | null>(null);
  const currentDocument = useRef<EditorDocument | undefined>(undefined);
  const undoStack = useRef<EditorDocument[]>([]);
  const redoStack = useRef<EditorDocument[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [photos, setPhotos] = useState<PhotoAsset[]>(isNative ? [] : [demoPhoto]);
  const [activeId, setActiveId] = useState(isNative ? "" : demoPhoto.id);
  const [checkedIds, setCheckedIds] = useState<string[]>(isNative ? [] : [demoPhoto.id]);
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>(initialDocuments);
  const [templates, setTemplates] = useState<TemplateRecord[]>(readTemplates);
  const [activeTemplate, setActiveTemplate] = useState("blur-bottom");
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("frame");
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [exportSettings, setExportSettings] = useState(defaultExport);
  const [exportRunning, setExportRunning] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportSummary | null>(null);
  const [sessionReady, setSessionReady] = useState(!isNative);
  const importBusy = useRef(false);

  const activePhoto = photos.find((photo) => photo.id === activeId) ?? photos[0];
  const activeDocument = activeId ? documents[activeId] : undefined;
  currentDocument.current = activeDocument;
  const selectedLayer = activeDocument?.layers.find((item) => item.id === selectedLayerId);
  const selectedCount = checkedIds.length;
  const canUndo = undoStack.current.length > 0 && historyRevision >= 0;
  const canRedo = redoStack.current.length > 0 && historyRevision >= 0;

  useEffect(() => {
    localStorage.setItem(templatesKey, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    if (!isNative) return;
    let dispose: (() => void) | undefined;
    void listen<ExportProgress>("export-progress", (event) => setExportProgress(event.payload)).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, []);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    async function restoreSession() {
      // StrictMode can tear down the first effect before any IPC work starts.
      await Promise.resolve();
      if (cancelled) return;
      setLoadState("loading");
      try {
        const saved = JSON.parse(localStorage.getItem(sessionKey) ?? "{}") as {
          paths?: string[];
          activePath?: string;
          checkedPaths?: string[];
          documentsByPath?: Record<string, EditorDocument>;
          overridesByPath?: Record<string, PhotoAsset["overrides"]>;
          exportSettings?: ExportSettings;
          activeTemplate?: string;
        };
        if (saved.exportSettings) setExportSettings({ ...defaultExport, ...saved.exportSettings });
        if (saved.activeTemplate) setActiveTemplate(saved.activeTemplate);
        if (saved.paths?.length) {
          const paths = [...new Set(saved.paths)];
          const order = new Map(paths.map((path, index) => [path, index]));
          // Restore the active photo first so the editor is available immediately.
          paths.sort((a, b) => Number(b === saved.activePath) - Number(a === saved.activePath));
          const checkedPaths = new Set(saved.checkedPaths ?? []);
          let restored = 0;
          let failed = 0;
          for (const [index, path] of paths.entries()) {
            const report = await invoke<InspectReport>("inspect_images_resilient", { paths: [path] });
            if (cancelled) return;
            for (const item of report.items) {
              const photo = { ...item, overrides: saved.overridesByPath?.[item.path] };
              setDocuments(current => ({ ...current, [photo.id]: saved.documentsByPath?.[photo.path] ?? createDefaultDocument() }));
              setPhotos(current => [...current, photo].sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0)));
              if (restored === 0) setActiveId(photo.id);
              if (checkedPaths.has(photo.path)) setCheckedIds(current => [...current, photo.id]);
              restored++;
            }
            failed += report.failures.length;
            setMessage(`正在恢复 ${index + 1}/${paths.length} 张照片`);
          }
          setMessage(failed
            ? `已恢复 ${restored} 张照片，${failed} 张原图已移动或不可读取，请重新导入`
            : restored ? `已恢复上次的 ${restored} 张照片` : "");
        }
        setLoadState("idle");
      } catch (error) {
        if (!cancelled) {
          setLoadState("error");
          setMessage(`无法恢复上次工作：${String(error)}`);
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }
    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isNative || !sessionReady || loadState === "loading") return;
    const checked = new Set(checkedIds);
    const documentsByPath: Record<string, EditorDocument> = {};
    const overridesByPath: Record<string, PhotoAsset["overrides"]> = {};
    for (const photo of photos) {
      if (!photo.path) continue;
      if (documents[photo.id]) documentsByPath[photo.path] = documents[photo.id];
      if (photo.overrides) overridesByPath[photo.path] = photo.overrides;
    }
    localStorage.setItem(sessionKey, JSON.stringify({
      paths: photos.map((photo) => photo.path).filter(Boolean),
      activePath: activePhoto?.path ?? "",
      checkedPaths: photos.filter((photo) => checked.has(photo.id)).map((photo) => photo.path),
      documentsByPath,
      overridesByPath,
      exportSettings,
      activeTemplate,
    }));
  }, [activePhoto?.path, activeTemplate, checkedIds, documents, exportSettings, photos, sessionReady, loadState]);

  function clearHistory() {
    undoStack.current = [];
    redoStack.current = [];
    transactionStart.current = null;
    setHistoryRevision((value) => value + 1);
  }

  function replaceActiveDocument(next: EditorDocument, record = true) {
    if (!activeId || !activeDocument) return;
    if (record) {
      undoStack.current.push(cloneDocument(activeDocument));
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
    }
    // A pointerup can follow pointermove before React paints the new document.
    // Transaction commits must already see that final drag position.
    currentDocument.current = next;
    setDocuments((current) => ({ ...current, [activeId]: next }));
    setHistoryRevision((value) => value + 1);
  }

  function updateDocument(mutator: (draft: EditorDocument) => void, record = true) {
    if (!currentDocument.current) return;
    const next = cloneDocument(currentDocument.current);
    mutator(next);
    replaceActiveDocument(next, record);
  }

  function beginTransaction() {
    if (!transactionStart.current && currentDocument.current) transactionStart.current = cloneDocument(currentDocument.current);
  }

  function commitTransaction() {
    const latest = currentDocument.current;
    if (!transactionStart.current || !latest) return;
    if (JSON.stringify(transactionStart.current) !== JSON.stringify(latest)) {
      undoStack.current.push(transactionStart.current);
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
      setHistoryRevision((value) => value + 1);
    }
    transactionStart.current = null;
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (!previous || !activeDocument || !activeId) return;
    redoStack.current.push(cloneDocument(activeDocument));
    setDocuments((current) => ({ ...current, [activeId]: previous }));
    setHistoryRevision((value) => value + 1);
  }

  function redo() {
    const next = redoStack.current.pop();
    if (!next || !activeDocument || !activeId) return;
    undoStack.current.push(cloneDocument(activeDocument));
    setDocuments((current) => ({ ...current, [activeId]: next }));
    setHistoryRevision((value) => value + 1);
  }

  function updateLayer(id: string, patch: Partial<WatermarkLayer>, record = true) {
    updateDocument((draft) => {
      const layer = draft.layers.find((item) => item.id === id);
      if (layer) Object.assign(layer, patch);
    }, record);
  }

  function addPhotos(next: PhotoAsset[], activate = true) {
    if (!next.length) return;
    setPhotos((current) => {
      const known = new Set(current.map((photo) => photo.path || photo.id));
      return [...current, ...next.filter((photo) => !known.has(photo.path || photo.id))];
    });
    setDocuments((current) => {
      const result = { ...current };
      for (const photo of next) if (!result[photo.id]) result[photo.id] = createDefaultDocument();
      return result;
    });
    setCheckedIds((current) => [...new Set([...current, ...next.map((photo) => photo.id)])]);
    if (activate) {
      setActiveId(next[0].id);
      setSelectedLayerId("");
      clearHistory();
    }
  }

  async function importNativePhotos() {
    if (importBusy.current || loadState === "loading") return;
    importBusy.current = true;
    setMessage("");
    try {
      const selection = await open({ multiple: true, directory: false, filters: [{ name: "摄影图片", extensions: ["jpg", "jpeg", "png"] }] });
      const selectedPaths = selection ? (Array.isArray(selection) ? selection : [selection]) : [];
      if (!selectedPaths.length) return;
      const known = new Set(photos.map(photo => photo.path));
      const paths = [...new Set(selectedPaths)].filter(path => !known.has(path));
      if (!paths.length) {
        setMessage("所选照片已在当前批次中");
        return;
      }
      setLoadState("loading");
      let imported = 0;
      let failed = 0;
      for (const [index, path] of paths.entries()) {
        setMessage(`正在导入 ${index + 1}/${paths.length} 张照片`);
        const report = await invoke<InspectReport>("inspect_images_resilient", { paths: [path] });
        addPhotos(report.items, imported === 0);
        imported += report.items.length;
        failed += report.failures.length;
      }
      setLoadState("idle");
      setMessage(failed
        ? `已导入 ${imported} 张，${failed} 张无法读取`
        : `已导入 ${imported} 张照片`);
    } catch (error) {
      setLoadState("error");
      setMessage(String(error));
    } finally {
      importBusy.current = false;
    }
  }

  async function importBrowserPhotos(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    if (!files.length || importBusy.current) return;
    importBusy.current = true;
    setLoadState("loading");
    try {
      let imported = 0;
      let failed = 0;
      const known = new Set(photos.map(photo => photo.id));
      for (const [index, file] of files.entries()) {
        const id = `browser-${file.name}-${file.size}-${file.lastModified}`;
        if (known.has(id)) continue;
        setMessage(`正在导入 ${index + 1}/${files.length} 张照片`);
        try {
          // Decode one original at a time, and retain only a bounded preview.
          const bitmap = await createImageBitmap(file);
          try {
            const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
            const preview = document.createElement("canvas");
            preview.width = Math.max(1, Math.round(bitmap.width * scale));
            preview.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = preview.getContext("2d");
            if (!context) throw new Error("无法生成缩略图");
            context.drawImage(bitmap, 0, 0, preview.width, preview.height);
            addPhotos([{
              id,
              path: "",
              fileName: file.name,
              width: bitmap.width,
              height: bitmap.height,
              megapixels: (bitmap.width * bitmap.height) / 1_000_000,
              thumbnailDataUrl: preview.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.84),
              metadata: {},
            }], imported === 0);
            imported++;
            known.add(id);
          } finally {
            bitmap.close();
          }
        } catch {
          failed++;
        }
      }
      setLoadState("idle");
      setMessage(`已导入 ${imported} 张照片${failed ? `，${failed} 张无法读取` : ""}，浏览器预览不读取 EXIF`);
    } catch (error) {
      setLoadState("error");
      setMessage(`读取图片失败：${String(error)}`);
    } finally {
      importBusy.current = false;
      input.value = "";
    }
  }

  function handleImport() {
    if (loadState === "loading") return;
    if (isNative) void importNativePhotos();
    else fileInput.current?.click();
  }

  function activatePhoto(id: string) {
    setActiveId(id);
    setSelectedLayerId("");
    clearHistory();
  }

  function toggleChecked(id: string) {
    setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function applyTemplate(template: TemplateRecord, targetIds: string[]) {
    setDocuments((current) => {
      const next = { ...current };
      for (const id of targetIds) {
        const photo = photos.find((item) => item.id === id);
        if (!photo) continue;
        const orientation = photoOrientation(photo);
        const layout = template.layouts[orientation] ?? template.layouts.landscape ?? template.layouts.portrait;
        if (layout) next[id] = cloneDocument(layout);
      }
      return next;
    });
    setActiveTemplate(template.id);
    setSelectedLayerId("");
    clearHistory();
    setMessage(`已应用“${template.name}”到 ${targetIds.length} 张照片`);
  }

  function updateCurrentTemplate() {
    if (!activePhoto || !activeDocument) return;
    const orientation = photoOrientation(activePhoto);
    setTemplates((current) => current.map((template) => template.id === activeTemplate ? {
      ...template,
      cover: activePhoto.thumbnailDataUrl,
      layouts: { ...template.layouts, [orientation]: cloneDocument(activeDocument) },
      updatedAt: Date.now(),
    } : template));
    setMessage(`已更新当前模板的${orientation === "landscape" ? "横图" : "竖图"}布局与封面`);
  }

  function saveNewTemplate() {
    if (!activePhoto || !activeDocument || !templateName.trim()) return;
    const orientation: Orientation = photoOrientation(activePhoto);
    const template: TemplateRecord = {
      id: `template-${Date.now()}`,
      name: templateName.trim(),
      description: `${orientation === "landscape" ? "横图" : "竖图"}布局，自定义模板`,
      builtIn: false,
      cover: activePhoto.thumbnailDataUrl,
      layouts: { [orientation]: cloneDocument(activeDocument) },
      updatedAt: Date.now(),
    };
    setTemplates((current) => [...current, template]);
    setActiveTemplate(template.id);
    setShowTemplateDialog(false);
    setTemplateName("");
    setMessage(`已保存新模板“${template.name}”`);
  }

  function addLayer(source: LayerSource) {
    const added = nextLayer(source, activeDocument?.layers.length ?? 0);
    updateDocument((draft) => { draft.layers.push(added); });
    setSelectedLayerId(added.id);
    setInspectorTab("watermark");
    setShowLayerMenu(false);
  }

  function deleteSelectedLayer() {
    if (!selectedLayer) return;
    updateDocument((draft) => { draft.layers = draft.layers.filter((item) => item.id !== selectedLayer.id); });
    setSelectedLayerId("");
  }

  function updatePhotoOverride(source: LayerSource, value: string) {
    if (!activePhoto || source === "custom") return;
    setPhotos((current) => current.map((photo) => photo.id === activePhoto.id ? { ...photo, overrides: { ...photo.overrides, [source]: value } } : photo));
  }

  async function selectOutputDirectory() {
    if (!isNative) {
      setExportSettings((current) => ({ ...current, directory: "浏览器下载目录" }));
      return;
    }
    const path = await open({ directory: true, multiple: false, title: "选择导出文件夹" });
    if (typeof path === "string") setExportSettings((current) => ({ ...current, directory: path }));
  }

  async function startExport(retryPaths?: Set<string>) {
    if (!isNative || !exportSettings.directory) return;
    const targetIds = exportSettings.range === "current"
      ? activeId ? [activeId] : []
      : exportSettings.range === "all"
        ? photos.map((photo) => photo.id)
        : checkedIds;
    const items = targetIds.flatMap((id) => {
      const photo = photos.find((candidate) => candidate.id === id);
      const document = documents[id];
      return photo?.path && document && (!retryPaths || retryPaths.has(photo.path)) ? [{
        path: photo.path,
        document,
        overrides: photo.overrides ?? {},
      }] : [];
    });
    if (!items.length) {
      setMessage("当前范围没有可导出的本地照片");
      return;
    }
    setShowExport(false);
    setExportResult(null);
    setExportRunning(true);
    setExportProgress({ current: 0, total: items.length, fileName: "准备导出", succeeded: 0, failed: 0, skipped: 0, stage: "preflight" });
    try {
      const result = await invoke<ExportSummary>("export_images", { request: { items, settings: exportSettings } });
      setExportResult(result);
      setMessage(result.cancelled ? "导出已取消，已完成的文件会保留" : `导出完成：成功 ${result.succeeded} 张`);
    } catch (error) {
      setExportResult({ total: items.length, succeeded: 0, failed: items.length, skipped: 0, cancelled: false, outputDirectory: exportSettings.directory, failures: [{ fileName: "导出任务", path: "", reason: String(error) }], warnings: [] });
      setMessage(`导出失败：${String(error)}`);
    } finally {
      setExportRunning(false);
    }
  }

  async function cancelExport() {
    if (isNative) await invoke("cancel_export");
  }

  function openExport(range: ExportSettings["range"]) {
    setExportSettings((current) => ({ ...current, range }));
    setShowExport(true);
  }

  const exportCount = useMemo(() => {
    if (exportSettings.range === "current") return activePhoto ? 1 : 0;
    if (exportSettings.range === "all") return photos.length;
    return selectedCount;
  }, [activePhoto, exportSettings.range, photos.length, selectedCount]);

  const sampleExportSize = useMemo(() => {
    if (!activePhoto || !activeDocument) return "";
    const geometry = calculateGeometry(activePhoto, activeDocument);
    const scale = exportSettings.size === "long-edge"
      ? exportSettings.longEdge / Math.max(geometry.width, geometry.height)
      : activePhoto.width / geometry.photo.width;
    return `${Math.round(geometry.width * scale)} × ${Math.round(geometry.height * scale)}`;
  }, [activeDocument, activePhoto, exportSettings.longEdge, exportSettings.size]);

  const activeTemplateRecord = templates.find((item) => item.id === activeTemplate);

  return (
    <div className="app-shell">
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png" multiple onChange={(event) => void importBrowserPhotos(event)} />

      <header className="app-header">
        <div className="brand-block" aria-label="映框"><span className="brand-mark"><FrameCorners weight="bold" /></span><div><strong>映框</strong><span>摄影水印与相框</span></div></div>
        <div className="project-title"><span>当前批次</span><strong>{photos.length ? `${photos.length} 张照片` : "未导入照片"}</strong></div>
        <div className="header-actions">
          <button className="icon-button" type="button" aria-label="撤销" disabled={!canUndo} onClick={undo}><ArrowCounterClockwise /></button>
          <button className="icon-button" type="button" aria-label="重做" disabled={!canRedo} onClick={redo}><ArrowClockwise /></button>
          <span className="header-divider" />
          <button className="button secondary" type="button" onClick={handleImport}><UploadSimple /> 导入照片</button>
          <button className="button secondary" type="button" onClick={() => openExport("current")} disabled={!activePhoto}><ImageSquare /> 导出当前</button>
          <button className="button primary" type="button" onClick={() => openExport(exportSettings.range === "current" ? "selected" : exportSettings.range)} disabled={!photos.length}><DownloadSimple /> 批量导出</button>
        </div>
      </header>

      <main className="workbench">
        <aside className="library-panel">
          <div className="panel-heading template-heading">
            <div><span>模板</span><strong>相框样式</strong></div>
            <div className="heading-actions">
              <button className="icon-button quiet" type="button" aria-label="更新当前模板" title="更新当前模板" disabled={!activeDocument} onClick={updateCurrentTemplate}><FloppyDisk /></button>
              <button className="icon-button quiet" type="button" aria-label="另存新模板" title="另存新模板" disabled={!activeDocument} onClick={() => { setTemplateName(`${activeTemplateRecord?.name ?? "相框"} 副本`); setShowTemplateDialog(true); }}><Copy /></button>
            </div>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <button className={`template-card ${activeTemplate === template.id ? "active" : ""}`} type="button" key={template.id} onClick={() => applyTemplate(template, activeId ? [activeId] : [])}>
                <span className={`template-preview ${template.id === "solid-white" ? "solid-template" : "blur-template"}`}><img src={template.cover} alt={`${template.name}模板`} /></span>
                <span><strong>{template.name}</strong><small>{template.description}</small></span>
                {activeTemplate === template.id && <Check weight="bold" />}
              </button>
            ))}
          </div>
          {!!activeDocument && !!checkedIds.length && <button className="apply-batch-button" type="button" onClick={() => activeTemplateRecord && applyTemplate(activeTemplateRecord, checkedIds)}>应用当前模板到已选 {checkedIds.length} 张</button>}

          <div className="library-section-title"><span>照片</span><small>{photos.length}</small></div>
          <div className="photo-list">
            {!photos.length ? (
              <button className="library-empty" type="button" onClick={handleImport}><ImageSquare /><span>导入 JPEG 或 PNG</span></button>
            ) : photos.map((photo) => (
              <button type="button" key={photo.id} className={`photo-row ${photo.id === activePhoto?.id ? "active" : ""}`} onClick={() => activatePhoto(photo.id)}>
                <span className="check-control" role="checkbox" aria-checked={checkedIds.includes(photo.id)} onClick={(event) => { event.stopPropagation(); toggleChecked(photo.id); }}>{checkedIds.includes(photo.id) && <Check weight="bold" />}</span>
                <img src={photo.thumbnailDataUrl} alt="" /><span className="photo-row-copy"><strong>{photo.fileName}</strong><small>{formatPixels(photo)}</small></span>
              </button>
            ))}
          </div>
          <button className="add-photo-button" type="button" onClick={handleImport}><Plus /> 添加照片</button>
        </aside>

        <section className="editor-panel">
          <EditorWorkspace photo={activePhoto} document={activeDocument} loading={loadState === "loading"} onImport={handleImport} onToggleSnap={() => setSnapEnabled(value => !value)} selectedLayerId={selectedLayerId} snapEnabled={snapEnabled} onSelectLayer={(id) => { setSelectedLayerId(id); if (id) setInspectorTab("watermark"); }} onLayerPreview={(id, patch) => updateLayer(id, patch, false)} onDragStart={beginTransaction} onDragEnd={commitTransaction} />

          <div className={`status-bar ${loadState === "error" ? "error" : ""}`}><span>{message || (selectedLayer ? `已选：${selectedLayer.name}` : activePhoto ? `${activePhoto.fileName}  ${activePhoto.megapixels.toFixed(1)} MP` : "准备就绪")}</span><span>{activePhoto ? `${formatPixels(activePhoto)}  sRGB  预览` : "完全本地处理"}</span></div>
          <div className="filmstrip"><div className="filmstrip-heading"><span>{photos.length} 张照片</span><span>已选 {selectedCount} 张</span></div><div className="filmstrip-track">{photos.map((photo) => <button type="button" key={photo.id} className={`film-photo ${photo.id === activePhoto?.id ? "active" : ""}`} onClick={() => activatePhoto(photo.id)}><img src={photo.thumbnailDataUrl} alt={photo.fileName} /><span>{photo.fileName}</span></button>)}{!!photos.length && <button className="film-add" type="button" onClick={handleImport}><Plus /><span>添加</span></button>}</div></div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs"><button type="button" className={inspectorTab === "frame" ? "active" : ""} onClick={() => setInspectorTab("frame")}><FrameCorners /> 相框</button><button type="button" className={inspectorTab === "watermark" ? "active" : ""} onClick={() => setInspectorTab("watermark")}><TextT /> 水印</button></div>
          {activeDocument && inspectorTab === "frame" ? (
            <div className="inspector-scroll">
              <section className="inspector-section">
                <div className="section-heading"><strong>相框外观</strong><span>实时预览</span></div>
                <Segmented label="相框类型" value={activeDocument.frame.type} options={[{ value: "blur", label: "照片模糊" }, { value: "solid", label: "纯色" }]} onChange={(value) => updateDocument((draft) => { draft.frame.type = value; })} />
                {activeDocument.frame.type === "blur" ? <><SliderRow label="模糊程度" value={activeDocument.frame.blur} min={0} max={70} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.blur = value; }, false)} /><SliderRow label="背景亮度" value={activeDocument.frame.brightness} min={30} max={130} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.brightness = value; }, false)} /></> : <label className="field color-field"><span>相框颜色</span><span className="color-input-wrap"><input type="color" value={activeDocument.frame.color} onChange={(event) => updateDocument((draft) => { draft.frame.color = event.currentTarget.value; })} /><code>{activeDocument.frame.color.toUpperCase()}</code></span></label>}
              </section>
              <section className="inspector-section">
                <div className="section-heading"><strong>照片与基础留白</strong><span>相对成品短边</span></div>
                <SliderRow label="左右基础留白" value={activeDocument.frame.paddingX} min={0} max={20} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.paddingX = value; }, false)} /><SliderRow label="上下基础留白" value={activeDocument.frame.paddingY} min={0} max={20} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.paddingY = value; }, false)} /><SliderRow label="照片圆角" value={activeDocument.frame.radius} min={0} max={32} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.radius = value; }, false)} /><SliderRow label="照片阴影" value={activeDocument.frame.shadow} min={0} max={64} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.shadow = value; }, false)} />
              </section>
              <section className="inspector-section">
                <div className="section-heading"><strong>四边参数区</strong><span>可同时开启</span></div><p className="section-help">上下区域占整宽，左右区域只占照片高度。区域尺寸同样按成品短边计算。</p>
                <div className="region-grid">{(Object.keys(regionLabels) as Array<Exclude<RegionId, "canvas">>).map((regionId) => { const settings = activeDocument.regions[regionId]; return <button type="button" className={settings.enabled ? "enabled" : ""} key={regionId} onClick={() => updateDocument((draft) => { draft.regions[regionId].enabled = !settings.enabled; })}><span>{regionLabels[regionId]}</span><small>{settings.enabled ? `${settings.extra}%` : "关闭"}</small></button>; })}</div>
                {(Object.keys(regionLabels) as Array<Exclude<RegionId, "canvas">>).filter((id) => activeDocument.regions[id].enabled).map((regionId) => <SliderRow key={regionId} label={`${regionLabels[regionId]}区额外空间`} value={activeDocument.regions[regionId].extra} min={0} max={30} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.regions[regionId].extra = value; }, false)} />)}
              </section>
            </div>
          ) : activeDocument ? (
            <div className="inspector-scroll">
              <section className="inspector-section layer-section">
                <div className="section-heading layer-heading"><strong>水印图层</strong><div className="layer-add-wrap"><button type="button" onClick={() => setShowLayerMenu((value) => !value)}><Plus /> 添加参数</button>{showLayerMenu && <div className="layer-add-menu">{metadataOptions.map((option) => <button type="button" key={option.source} onClick={() => addLayer(option.source)}>{option.label}</button>)}</div>}</div></div>
                <div className="layer-list">{activeDocument.layers.map((item) => <div className={`layer-row ${item.id === selectedLayerId ? "selected" : ""}`} key={item.id}><button className="layer-main" type="button" onClick={() => setSelectedLayerId(item.id)}><TextT /><span><strong>{item.name}</strong><small>{activePhoto ? resolveLayerText(item, activePhoto) : ""}</small></span></button><button className="layer-visibility" type="button" aria-label={`${item.visible ? "隐藏" : "显示"}${item.name}`} onClick={() => updateLayer(item.id, { visible: !item.visible })}>{item.visible ? <Eye /> : <EyeSlash />}</button></div>)}</div>
              </section>
              {selectedLayer && activePhoto ? (
                <section className="inspector-section selected-layer-panel">
                  <div className="section-heading"><strong>{selectedLayer.name}</strong><button type="button" className="danger-action" onClick={deleteSelectedLayer}><Trash /> 删除</button></div>
                  {selectedLayer.source === "custom" ? <label className="field"><span>文字内容</span><input className="text-input" value={selectedLayer.customValue} onChange={(event) => updateLayer(selectedLayer.id, { customValue: event.currentTarget.value })} /></label> : <label className="field"><span>当前照片显示值</span><input className="text-input" value={activePhoto.overrides?.[selectedLayer.source] ?? activePhoto.metadata[selectedLayer.source] ?? ""} placeholder="未读取到，可手动补充" onChange={(event) => updatePhotoOverride(selectedLayer.source, event.currentTarget.value)} /></label>}
                  <label className="field"><span>所属区域</span><select value={selectedLayer.region} onChange={(event) => updateLayer(selectedLayer.id, { region: event.currentTarget.value as RegionId, x: 0.5, y: 0.5 })}><option value="canvas">整个画布</option><option value="top">上参数区</option><option value="bottom">下参数区</option><option value="left">左参数区</option><option value="right">右参数区</option></select></label>
                  <div className="align-grid"><button type="button" onClick={() => updateLayer(selectedLayer.id, { x: 0.5 })}>水平居中</button><button type="button" onClick={() => updateLayer(selectedLayer.id, { y: 0.5 })}>垂直居中</button><button type="button" onClick={() => updateLayer(selectedLayer.id, { y: 1 / 3 })}>第 1 行</button><button type="button" onClick={() => updateLayer(selectedLayer.id, { y: 2 / 3 })}>第 2 行</button></div>
                  <label className="field"><span>字体</span><select value={selectedLayer.fontFamily} onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.currentTarget.value })}><option value="Noto Sans CJK SC, sans-serif">Noto Sans 思源黑体</option><option value="Noto Serif CJK SC, serif">Noto Serif 思源宋体</option><option value="DejaVu Sans, sans-serif">DejaVu Sans</option><option value="Liberation Sans, sans-serif">Liberation Sans</option><option value="monospace">等宽字体</option></select></label>
                  <SliderRow label="字号" value={selectedLayer.fontSize} min={8} max={120} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateLayer(selectedLayer.id, { fontSize: value }, false)} /><label className="field"><span>字重</span><select value={selectedLayer.fontWeight} onChange={(event) => updateLayer(selectedLayer.id, { fontWeight: Number(event.currentTarget.value) as WatermarkLayer["fontWeight"] })}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label><label className="field color-field"><span>文字颜色</span><span className="color-input-wrap"><input type="color" value={selectedLayer.color} onChange={(event) => updateLayer(selectedLayer.id, { color: event.currentTarget.value })} /><code>{selectedLayer.color.toUpperCase()}</code></span></label>
                  <Segmented label="文字方向" value={String(selectedLayer.rotation)} options={[{ value: "0", label: "横排" }, { value: "-90", label: "左转" }, { value: "90", label: "右转" }]} onChange={(value) => updateLayer(selectedLayer.id, { rotation: Number(value) as WatermarkLayer["rotation"] })} /><div className="coordinate-readout"><span>X {(selectedLayer.x * 100).toFixed(1)}%</span><span>Y {(selectedLayer.y * 100).toFixed(1)}%</span></div>
                </section>
              ) : <section className="inspector-section muted-section"><strong>选择画布中的文字</strong><p>拖动可以自由定位。接近画布、照片或当前参数区的中心与三等分点时会显示名称并吸附。</p></section>}
            </div>
          ) : <div className="inspector-empty">导入照片后开始设置</div>}
        </aside>
      </main>

      {showTemplateDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTemplateDialog(false); }}><section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title"><header><div><span>模板库</span><h2 id="template-title">另存为新模板</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowTemplateDialog(false)}><X /></button></header><div className="compact-dialog-body"><label className="field"><span>模板名称</span><input autoFocus className="text-input" value={templateName} onChange={(event) => setTemplateName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") saveNewTemplate(); }} /></label><p>保存当前方向的相框、四边区域、水印字段、字体和位置，并使用当前照片更新封面。</p></div><footer><button className="button secondary" type="button" onClick={() => setShowTemplateDialog(false)}>取消</button><button className="button primary" type="button" disabled={!templateName.trim()} onClick={saveNewTemplate}>保存模板</button></footer></section></div>}

      {showExport && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowExport(false); }}>
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <header><div><span>{exportSettings.range === "current" ? "单张导出" : "批量导出"}</span><h2 id="export-title">导出 {exportCount} 张照片</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowExport(false)}><X /></button></header>
            <div className="export-body">
              <Segmented label="导出范围" value={exportSettings.range} options={[{ value: "current", label: "当前" }, { value: "selected", label: `已选 ${selectedCount}` }, { value: "all", label: `全部 ${photos.length}` }]} onChange={(range) => setExportSettings((value) => ({ ...value, range }))} />
              <label className="field"><span>输出文件夹</span><button className="directory-picker" type="button" aria-label="输出文件夹" onClick={() => void selectOutputDirectory()}><FolderOpen /><span>{exportSettings.directory || "选择本地文件夹"}</span><CaretDown /></button></label>
              <div className="export-grid">
                <label className="field"><span>格式</span><select value={exportSettings.format} onChange={(event) => { const format = event.currentTarget.value as "jpeg" | "png"; setExportSettings((value) => ({ ...value, format })); }}><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>
                <label className="field"><span>成品尺寸</span><select value={exportSettings.size} onChange={(event) => { const size = event.currentTarget.value as "original" | "long-edge"; setExportSettings((value) => ({ ...value, size })); }}><option value="original">保持主照片像素</option><option value="long-edge">指定成品长边</option></select></label>
              </div>
              {exportSettings.size === "long-edge" && <label className="field"><span>成品长边像素</span><input className="text-input" type="number" min="800" max="30000" value={exportSettings.longEdge} onChange={(event) => { const longEdge = Number(event.currentTarget.value); setExportSettings((value) => ({ ...value, longEdge })); }} /></label>}
              {exportSettings.format === "jpeg" ? (
                <SliderRow label="JPEG 质量" value={exportSettings.quality} min={1} max={100} onChange={(quality) => setExportSettings((value) => ({ ...value, quality }))} />
              ) : (
                <Segmented label="PNG 压缩" value={exportSettings.pngCompression} options={[{ value: "fast", label: "快速" }, { value: "standard", label: "标准" }, { value: "small", label: "更小" }]} onChange={(pngCompression) => setExportSettings((value) => ({ ...value, pngCompression }))} />
              )}
              <div className="export-grid">
                <label className="field"><span>文件名后缀</span><input className="text-input" value={exportSettings.suffix} onChange={(event) => { const suffix = event.currentTarget.value; setExportSettings((value) => ({ ...value, suffix })); }} /></label>
                <label className="field"><span>重名处理</span><select value={exportSettings.collision} onChange={(event) => { const collision = event.currentTarget.value as ExportSettings["collision"]; setExportSettings((value) => ({ ...value, collision })); }}><option value="number">自动编号</option><option value="skip">跳过</option></select></label>
              </div>
              <label className="field"><span>元数据</span><select value={exportSettings.metadata} onChange={(event) => { const metadata = event.currentTarget.value as ExportSettings["metadata"]; setExportSettings((value) => ({ ...value, metadata })); }}><option value="none">不保留</option><option value="basic">保留基础拍摄信息</option><option value="supported">尽可能保留受支持信息</option></select></label>
              <label className={`check-field ${exportSettings.metadata === "none" ? "disabled" : ""}`}><input type="checkbox" checked={exportSettings.includeGps} disabled={exportSettings.metadata === "none"} onChange={(event) => { const includeGps = event.currentTarget.checked; setExportSettings((value) => ({ ...value, includeGps })); }} /><span><strong>保留 GPS 位置</strong><small>默认关闭，单独控制照片中的定位信息</small></span></label>
              <div className="export-summary"><span>文件名示例</span><strong>{activePhoto?.fileName.replace(/\.[^.]+$/, "") ?? "照片"}{exportSettings.suffix}.{exportSettings.format === "jpeg" ? "jpg" : "png"}</strong>{sampleExportSize && <small>当前样例成品 {sampleExportSize} px，水印按成品短边等比缩放</small>}</div>
            </div>
            <footer><span>原图不会被覆盖，设置会随上次工作自动恢复。</span><div><button className="button secondary" type="button" onClick={() => setShowExport(false)}>取消</button><button className="button primary" type="button" disabled={!exportSettings.directory || exportCount === 0} onClick={() => isNative ? void startExport() : (setShowExport(false), setMessage("导出设置已保存"))}>{isNative ? "开始导出" : "保存设置"}</button></div></footer>
          </section>
        </div>
      )}

      {exportRunning && exportProgress && (
        <div className="modal-backdrop">
          <section className="progress-dialog" role="dialog" aria-modal="true" aria-labelledby="progress-title">
            <header><span>批量导出</span><h2 id="progress-title">正在生成成品</h2></header>
            <div className="progress-body">
              <div className="progress-count"><strong>{exportProgress.current} / {exportProgress.total}</strong><span>{exportProgress.fileName}</span></div>
              <progress max={exportProgress.total || 1} value={exportProgress.current} />
              <div className="progress-stats"><span>成功 {exportProgress.succeeded}</span><span>失败 {exportProgress.failed}</span><span>跳过 {exportProgress.skipped}</span></div>
              <p>按原图顺序逐张处理。取消会停止后续照片，已经完成的文件会保留。</p>
            </div>
            <footer><button className="button secondary" type="button" onClick={() => void cancelExport()}>取消后续任务</button></footer>
          </section>
        </div>
      )}

      {!exportRunning && exportResult && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportResult(null); }}>
          <section className="result-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title">
            <header><div><span>{exportResult.cancelled ? "任务已取消" : "批量导出"}</span><h2 id="result-title">{exportResult.failed ? "导出完成，部分照片需要处理" : "导出完成"}</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setExportResult(null)}><X /></button></header>
            <div className="result-body">
              <div className="result-stats"><div><strong>{exportResult.succeeded}</strong><span>成功</span></div><div><strong>{exportResult.failed}</strong><span>失败</span></div><div><strong>{exportResult.skipped}</strong><span>跳过</span></div></div>
              {!!exportResult.failures.length && <div className="result-list"><strong><WarningCircle /> 失败项目</strong>{exportResult.failures.map((failure) => <div key={`${failure.fileName}-${failure.reason}`}><span>{failure.fileName}</span><small>{failure.reason}</small></div>)}</div>}
              {!!exportResult.warnings.length && <div className="result-list"><strong><WarningCircle /> 元数据提示</strong>{exportResult.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div>}
            </div>
            <footer>
              <button className="button secondary" type="button" onClick={() => setExportResult(null)}>关闭</button>
              {!!exportResult.failures.some((failure) => failure.path) && <button className="button secondary" type="button" onClick={() => { const paths = new Set(exportResult.failures.map((failure) => failure.path).filter(Boolean)); setExportResult(null); void startExport(paths); }}>重试失败项</button>}
              <button className="button primary" type="button" onClick={() => void openPath(exportResult.outputDirectory)}><FolderSimple /> 打开输出文件夹</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
