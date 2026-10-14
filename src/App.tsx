import { WindowChrome } from "./WindowChrome";
import { SelectControl } from "./SelectControl";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { importDirectoryKey, readImportDirectory, selectedImportDirectory } from "./import-location";
import { usePhotoDrop } from "./use-photo-drop";
import { cropPixels } from "./photo-crop";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  Check,
  Copy,
  DownloadSimple,
  FloppyDisk,
  FolderSimple,
  FolderOpen,
  FrameCorners,
  ImageSquare,
  Plus,
  Stack,
  Trash,
  TextT,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { EditorWorkspace } from "./EditorWorkspace";
import { parseSession, relocateSessionPath, type SessionSnapshot } from "./session-storage";
import { Modal } from "./Modal";
import { emptyPhotoFilter, filterPhotos, selectVisiblePhotos, type PhotoDirection, type PhotoFilter } from "./photo-filter";
import { ExportElapsed } from "./ExportElapsed";
import { StorageRecoveryDialog, type StorageRecovery } from "./StorageRecoveryDialog";
import { TemplateManager } from "./TemplateManager";
import { TemplatePreview } from "./TemplatePreview";
import { builtInDefaultTemplateId } from "./builtin-template-catalog";
import type { EditorCanvasHandle } from "./EditorCanvas";
import { LayerInspector } from "./LayerInspector";
import { SliderRow, Segmented } from "./EditorControls";
import { selectLayer, moveSelection, type LayerPatch } from "./selection-model";
import { isVisible } from "./canvas-camera";
import { retainBrowserPhoto, releaseBrowserPhoto, releaseBrowserPhotos } from "./use-editor-photo";
import {
  builtInTemplates,
  calculateGeometry,
  cloneDocument,
  createDefaultDocument,
  nextLayer,
  photoOrientation,
} from "./editor-model";
import { maxTemplateNameLength, templateNameError, copyTemplateName, defaultTemplateKey, documentFromTemplate, importTemplates, readDefaultTemplateId, readTemplateLibrary, serializeUserTemplates, templatesKey, type ImportDecision } from "./template-library";
import { buildExportPlan, createExportRequest, retryExportRequest, formatElapsed, type ExportIssue, type ExportRequest } from "./export-workflow";
import type {
  EditorDocument,
  ExportPreflight,
  ExportProgress,
  ExportSettings,
  ExportSummary,
  LayerSource,
  PhotoAsset,
  PhotoCrop,
  RegionId,
  TemplateRecord,
  WatermarkLayer,
} from "./types";
import "./App.css";

const CropEditor = lazy(() => import("./CropEditor"));

const isNative = "__TAURI_INTERNALS__" in window;
const sessionKey = "yingkuang-session-v2";
// GTK file filters use case-sensitive globs; camera extensions often arrive uppercase.
const imageExtensions = ["jpg", "jpeg", "png"].flatMap(extension =>
  Array.from({ length: 2 ** extension.length }, (_, mask) =>
    [...extension].map((letter, index) => mask & (1 << index) ? letter.toUpperCase() : letter).join("")));


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
  noUpscale: false,
  metadata: "basic",
  includeGps: false,
  range: "selected",
  suffix: "-相框",
  suffixMode: "template",
  collision: "number",
  pngCompression: "standard",
};

type LoadState = "idle" | "loading" | "error";
type InspectorTab = "template" | "frame" | "watermark";
type Orientation = "landscape" | "portrait";
type HistoryEntry = {
  documents: Record<string, EditorDocument>;
  overrides: Record<string, PhotoAsset["overrides"]>;
  templates: Record<string, string | undefined>;
  crops: Record<string, PhotoCrop | undefined>;
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

const exportStageLabels: Record<ExportProgress["stage"], string> = {
  preflight: "正在预检文件与输出设置",
  preparing: "正在准备照片",
  rendering: "正在渲染相框与水印",
  encoding: "正在编码成品",
  metadata: "正在整理元数据",
  finishing: "正在完成文件",
  "completed-item": "已完成当前照片",
};

function formatPixels(photo: PhotoAsset) {
  const crop = cropPixels(photo);
  return `${crop.width} × ${crop.height}${photo.crop ? " · 已调整" : ""}`;
}

function initialDocuments() {
  return isNative ? {} : { [demoPhoto.id]: createDefaultDocument() };
}

function App() {
  const exportDirectoryId = useId();
  const exportBody = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const transactionStart = useRef<HistoryEntry | null>(null);
  const currentDocument = useRef<EditorDocument | undefined>(undefined);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [photos, setPhotos] = useState<PhotoAsset[]>(isNative ? [] : [demoPhoto]);
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>(emptyPhotoFilter);
  const [activeId, setActiveId] = useState(isNative ? "" : demoPhoto.id);
  const [checkedIds, setCheckedIds] = useState<string[]>(isNative ? [] : [demoPhoto.id]);
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>(initialDocuments);
  const [initialLibrary] = useState(readTemplateLibrary);
  const templateWriteBlocked = useRef(!initialLibrary.canPersist);
  const [templates, setTemplates] = useState<TemplateRecord[]>(initialLibrary.templates);
  const [defaultTemplateId, setDefaultTemplateId] = useState(() => readDefaultTemplateId(initialLibrary.templates));
  const [templateByPhoto, setTemplateByPhoto] = useState<Record<string, string>>(isNative ? {} : { [demoPhoto.id]: builtInDefaultTemplateId() });
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const editorRef = useRef<EditorCanvasHandle>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("template");
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<{ ids: string[]; missingPaths: string[] } | null>(null);
  const [exportSettings, setExportSettings] = useState(defaultExport);
  const [exportRunning, setExportRunning] = useState(false);
  const [exportStartedAt, setExportStartedAt] = useState(0);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportSummary | null>(null);
  const [exportIssues, setExportIssues] = useState<ExportIssue[]>([]);
  const [exportChecking, setExportChecking] = useState(false);
  const [exportCancelling, setExportCancelling] = useState(false);
  const [sessionReady, setSessionReady] = useState(!isNative);
  const importBusy = useRef(false);
  const lastImportDirectory = useRef<string | undefined>(undefined);
  const lastExportRequest = useRef<ExportRequest | null>(null);
  const exportBusy = useRef(false);
  const restoredSession = useRef<SessionSnapshot>({ paths: [] });
  const sessionWriteBlocked = useRef(false);
  const [missingPhotos, setMissingPhotos] = useState<Array<{ path: string; reason: string }>>([]);
  const [pendingRelink, setPendingRelink] = useState<{ oldPath: string; photo: PhotoAsset } | null>(null);
  const [relinkError, setRelinkError] = useState<{ path: string; message: string } | null>(null);
  const [storageErrors, setStorageErrors] = useState<Record<string, string>>({});
  const [pendingStorageRecovery, setPendingStorageRecovery] = useState<StorageRecovery | null>(null);

  function storageError(scope: string, message: string) {
    setStorageErrors(current => current[scope] === message ? current : { ...current, [scope]: message });
  }

  useEffect(() => () => releaseBrowserPhotos(), []);

  const activePhoto = photos.find((photo) => photo.id === activeId) ?? photos[0];
  const activeDocument = activeId ? documents[activeId] : undefined;
  const activeTemplate = templateByPhoto[activeId] ?? defaultTemplateId;
  currentDocument.current = activeDocument;
  const selectedLayers = activeDocument?.layers.filter(item => selectedLayerIds.includes(item.id)) ?? [];
  const selectedCount = checkedIds.length;
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const visiblePhotos = useMemo(() => filterPhotos(photos, photoFilter), [photos, photoFilter]);
  const visiblePhotoIds = new Set(visiblePhotos.map(photo => photo.id));
  const visiblePhotoPaths = new Set(visiblePhotos.map(photo => photo.path));
  const filtersActive = !!photoFilter.query.trim() || photoFilter.direction !== "all";
  const visibleSelectedCount = visiblePhotos.filter(photo => checkedSet.has(photo.id)).length;
  const hiddenSelectedCount = selectedCount - visibleSelectedCount;
  const pendingHiddenCount = pendingRemoval?.ids.filter(id => !visiblePhotoIds.has(id)).length ?? 0;
  const canUndo = undoStack.current.length > 0 && historyRevision >= 0;
  const canRedo = redoStack.current.length > 0 && historyRevision >= 0;

  useEffect(() => {
    if (templateWriteBlocked.current) { storageError("templates", initialLibrary.issue); return; }
    try { localStorage.setItem(templatesKey, serializeUserTemplates(templates)); storageError("templates", ""); }
    catch (error) { storageError("templates", `模板库暂未保存，请先导出备份：${String(error)}`); }
  }, [templates]);

  useEffect(() => {
    try { localStorage.setItem(defaultTemplateKey, defaultTemplateId); storageError("defaultTemplate", ""); }
    catch { storageError("defaultTemplate", "默认模板未能保存，下次启动可能恢复旧设置。"); }
  }, [defaultTemplateId]);

  useEffect(() => {
    if (!isNative) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<ExportProgress>("export-progress", (event) => {
      if (!cancelled && exportBusy.current) setExportProgress(event.payload);
    }).then((unlisten) => {
      if (cancelled) unlisten(); else dispose = unlisten;
    }).catch((error) => { if (!cancelled) setMessage(`导出进度监听失败：${String(error)}`); });
    return () => { cancelled = true; dispose?.(); };
  }, []);

  useEffect(() => {
    setExportIssues((current) => current.some((issue) => issue.field === "preflight") ? [] : current);
  }, [exportSettings]);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    async function restoreSession() {
      // StrictMode can tear down the first effect before any IPC work starts.
      await Promise.resolve();
      if (cancelled) return;
      setLoadState("loading");
      try {
        const saved = parseSession(localStorage.getItem(sessionKey));
        restoredSession.current = saved;
        if (saved.exportSettings) setExportSettings({ ...defaultExport, ...saved.exportSettings, suffixMode: saved.exportSettings.suffixMode ?? "custom" });
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
              const photo = { ...item, overrides: saved.overridesByPath?.[item.path], crop: saved.cropsByPath?.[item.path] };
              setDocuments(current => ({ ...current, [photo.id]: saved.documentsByPath?.[photo.path] ?? createDefaultDocument() }));
              const sourceTemplate = saved.templateIdsByPath?.[photo.path] ?? saved.activeTemplate ?? defaultTemplateId;
              if (templates.some((template) => template.id === sourceTemplate)) setTemplateByPhoto(current => ({ ...current, [photo.id]: sourceTemplate }));
              setPhotos(current => [...current, photo].sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0)));
              if (restored === 0) setActiveId(photo.id);
              if (checkedPaths.has(photo.path)) setCheckedIds(current => [...current, photo.id]);
              restored++;
            }
            setMissingPhotos(current => [...current, ...report.failures]);
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
          sessionWriteBlocked.current = true;
          storageError("session", "上次工作无法完整恢复，原始记录已保留；本次修改暂不自动保存。");
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

  function captureSession(): SessionSnapshot {
    const checked = new Set(checkedIds);
    const documentsByPath: Record<string, EditorDocument> = {};
    const overridesByPath: Record<string, PhotoAsset["overrides"]> = {};
    const templateIdsByPath: Record<string, string> = {};
    const dimensionsByPath: NonNullable<SessionSnapshot["dimensionsByPath"]> = {};
    const cropsByPath: NonNullable<SessionSnapshot["cropsByPath"]> = {};
    const saved = restoredSession.current;
    const unavailable = missingPhotos.filter(item => !photos.some(photo => photo.path === item.path));
    for (const { path } of unavailable) {
      if (saved.documentsByPath?.[path]) documentsByPath[path] = saved.documentsByPath[path];
      if (saved.overridesByPath?.[path]) overridesByPath[path] = saved.overridesByPath[path];
      if (saved.templateIdsByPath?.[path]) templateIdsByPath[path] = saved.templateIdsByPath[path];
      if (saved.dimensionsByPath?.[path]) dimensionsByPath[path] = saved.dimensionsByPath[path];
      if (saved.cropsByPath?.[path]) cropsByPath[path] = saved.cropsByPath[path];
    }
    for (const photo of photos) {
      if (!photo.path) continue;
      if (documents[photo.id]) documentsByPath[photo.path] = documents[photo.id];
      if (photo.overrides) overridesByPath[photo.path] = photo.overrides;
      if (templateByPhoto[photo.id]) templateIdsByPath[photo.path] = templateByPhoto[photo.id];
      dimensionsByPath[photo.path] = { width: photo.width, height: photo.height };
      if (photo.crop) cropsByPath[photo.path] = photo.crop;
    }
    const order = new Map(saved.paths.map((path, index) => [path, index]));
    const paths = [...new Set([...photos.map(photo => photo.path).filter(Boolean), ...unavailable.map(item => item.path)])]
      .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
    const snapshot: SessionSnapshot = {
      paths,
      activePath: activePhoto?.path ?? "",
      checkedPaths: [...photos.filter(photo => checked.has(photo.id)).map(photo => photo.path), ...unavailable.filter(item => saved.checkedPaths?.includes(item.path)).map(item => item.path)],
      documentsByPath,
      overridesByPath,
      templateIdsByPath,
      dimensionsByPath,
      cropsByPath,
      exportSettings,
    };
    return snapshot;
  }

  useEffect(() => {
    if (!isNative || !sessionReady || loadState === "loading" || sessionWriteBlocked.current) return;
    const snapshot = captureSession();
    try { localStorage.setItem(sessionKey, JSON.stringify(snapshot)); restoredSession.current = snapshot; storageError("session", ""); }
    catch { storageError("session", "当前工作尚未自动保存，请检查可用存储空间；原有记录仍保留。"); }
  }, [activePhoto?.path, checkedIds, documents, exportSettings, photos, sessionReady, loadState, templateByPhoto, missingPhotos]);

  function retryDefaultTemplateSave() {
    try { localStorage.setItem(defaultTemplateKey, defaultTemplateId); storageError("defaultTemplate", ""); }
    catch { storageError("defaultTemplate", "默认模板仍未能保存，请检查可用存储空间后重试。"); }
  }

  function beginStorageRecovery(scope: "session" | "templates") {
    if (!sessionReady || loadState === "loading") return;
    try {
      const key = scope === "session" ? sessionKey : templatesKey;
      const keys = scope === "session" ? [key] : [key, "yingkuang-templates-v1"];
      const currentContent = scope === "session" ? JSON.stringify(captureSession()) : serializeUserTemplates(templates);
      if (scope === "session") parseSession(currentContent);
      setPendingStorageRecovery({ scope, key, label: scope === "session" ? "工作记录" : "模板库",
        description: scope === "session" ? `当前批次有 ${photos.length} 张可用照片和 ${missingPhotos.length} 条缺失记录。` : `当前可读取 ${templates.length} 个模板。`,
        originalRecords: Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), currentContent });
    } catch (error) { storageError(scope, `无法准备恢复备份，原记录仍保留：${String(error)}`); }
  }

  function storageRecovered(recovery: StorageRecovery) {
    if (recovery.scope === "session") {
      sessionWriteBlocked.current = false;
      restoredSession.current = parseSession(recovery.currentContent);
    } else templateWriteBlocked.current = false;
    storageError(recovery.scope, "");
    setPendingStorageRecovery(null);
    setMessage(`${recovery.label}已恢复自动保存，原始记录已备份到所选文件`);
  }

  async function selectReplacementPhoto(oldPath: string) {
    if (importBusy.current || loadState === "loading") return;
    importBusy.current = true;
    setRelinkError(null);
    setLoadState("loading");
    try {
      const path = await open({ multiple: false, directory: false, title: "重新定位原图", filters: [{ name: "摄影图片", extensions: imageExtensions }] });
      if (typeof path !== "string") return;
      if (photos.some(photo => photo.path === path) || missingPhotos.some(photo => photo.path === path && path !== oldPath)) throw new Error("所选照片已在当前批次中，请选择对应的原图");
      const report = await invoke<InspectReport>("inspect_images_resilient", { paths: [path] });
      const photo = report.items[0];
      if (!photo) throw new Error(report.failures[0]?.reason ?? "无法读取所选照片");
      setPendingRelink({ oldPath, photo });
    } catch (error) {
      setRelinkError({ path: oldPath, message: `重新定位失败：${String(error)}` });
    } finally {
      importBusy.current = false;
      setLoadState("idle");
    }
  }

  function confirmReplacementPhoto() {
    if (!pendingRelink) return;
    const { oldPath, photo: inspected } = pendingRelink;
    try {
      if (photos.some(photo => photo.path === inspected.path || photo.id === inspected.id)) throw new Error("所选照片已在当前批次中");
      const saved = relocateSessionPath(restoredSession.current, oldPath, inspected.path);
      const photo = { ...inspected, overrides: saved.overridesByPath?.[inspected.path], crop: saved.cropsByPath?.[inspected.path] };
      const templateId = saved.templateIdsByPath?.[photo.path] ?? defaultTemplateId;
      const template = templates.find(template => template.id === templateId) ?? templates[0];
      const document = saved.documentsByPath?.[photo.path] ?? (template ? documentFromTemplate(template, photo) : createDefaultDocument());
      commitTransaction();
      restoredSession.current = saved;
      setDocuments(current => ({ ...current, [photo.id]: cloneDocument(document) }));
      setTemplateByPhoto(current => ({ ...current, [photo.id]: template?.id ?? defaultTemplateId }));
      const order = new Map(saved.paths.map((path, index) => [path, index]));
      setPhotos(current => [...current, photo].sort((a, b) => (order.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.path) ?? Number.MAX_SAFE_INTEGER)));
      if (saved.checkedPaths?.includes(photo.path)) setCheckedIds(current => [...new Set([...current, photo.id])]);
      setMissingPhotos(current => current.filter(item => item.path !== oldPath));
      setActiveId(photo.id);
      setPhotoFilter(emptyPhotoFilter);
      setSelectedLayerIds([]);
      setPendingRelink(null);
      setMessage(`已重新定位 ${photo.fileName}，原排版和手动文字已恢复，请检查画面`);
    } catch (error) {
      setPendingRelink(null);
      setRelinkError({ path: oldPath, message: `重新定位失败：${String(error)}` });
    }
  }

  function clearHistory() {
    undoStack.current = [];
    redoStack.current = [];
    transactionStart.current = null;
    setHistoryRevision((value) => value + 1);
  }

  function captureHistory(ids: string[]): HistoryEntry {
    const entry: HistoryEntry = { documents: {}, overrides: {}, templates: {}, crops: {} };
    for (const id of new Set(ids)) {
      const photo = photos.find(photo => photo.id === id);
      const document = id === activeId ? currentDocument.current : documents[id];
      if (!photo || !document) continue;
      entry.documents[id] = cloneDocument(document);
      entry.overrides[id] = structuredClone(photo.overrides);
      entry.templates[id] = templateByPhoto[id];
      entry.crops[id] = structuredClone(photo.crop);
    }
    return entry;
  }

  function pushHistory(entry: HistoryEntry) {
    if (!Object.keys(entry.documents).length) return;
    undoStack.current.push(entry);
    if (undoStack.current.length > 80) undoStack.current.shift();
    redoStack.current = [];
    setHistoryRevision(value => value + 1);
  }

  function restoreHistory(entry: HistoryEntry) {
    if (entry.documents[activeId]) currentDocument.current = cloneDocument(entry.documents[activeId]);
    setDocuments(current => ({ ...current, ...structuredClone(entry.documents) }));
    setPhotos(current => current.map(photo => Object.prototype.hasOwnProperty.call(entry.overrides, photo.id)
      ? { ...photo, overrides: structuredClone(entry.overrides[photo.id]), crop: structuredClone(entry.crops[photo.id]) } : photo));
    setTemplateByPhoto(current => {
      const next = { ...current };
      for (const [id, template] of Object.entries(entry.templates)) {
        if (template === undefined) delete next[id]; else next[id] = template;
      }
      return next;
    });
    setSelectedLayerIds(current => current.filter(id => currentDocument.current?.layers.some(layer => layer.id === id)));
    setHistoryRevision(value => value + 1);
  }

  function replaceActiveDocument(next: EditorDocument, record = true) {
    if (!activeId || !activeDocument) return;
    if (record) pushHistory(captureHistory([activeId]));
    // A pointerup can follow pointermove before React paints the final position.
    currentDocument.current = next;
    setDocuments(current => ({ ...current, [activeId]: next }));
    setHistoryRevision(value => value + 1);
  }

  function updateDocument(mutator: (draft: EditorDocument) => void, record = true) {
    if (!currentDocument.current) return;
    const next = cloneDocument(currentDocument.current);
    mutator(next);
    replaceActiveDocument(next, record);
  }

  function beginTransaction() {
    if (!transactionStart.current && currentDocument.current) transactionStart.current = captureHistory([activeId]);
  }

  function commitTransaction() {
    const before = transactionStart.current;
    if (!before) return;
    if (JSON.stringify(before) !== JSON.stringify(captureHistory(Object.keys(before.documents)))) pushHistory(before);
    transactionStart.current = null;
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(captureHistory(Object.keys(previous.documents)));
    restoreHistory(previous);
  }

  function applyCrop(crop: PhotoCrop | undefined) {
    if (!activePhoto) return;
    commitTransaction();
    if (JSON.stringify(activePhoto.crop) !== JSON.stringify(crop)) {
      pushHistory(captureHistory([activeId]));
      setPhotos(current => current.map(photo => photo.id === activeId ? { ...photo, crop } : photo));
    }
    setShowCrop(false);
    setMessage(crop ? "已应用裁切与旋转，相框与水印已适配选区" : "已恢复完整照片");
  }

  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(captureHistory(Object.keys(next.documents)));
    restoreHistory(next);
  }

  function updateLayers(patches: LayerPatch[], record = true) {
    if (!currentDocument.current) return;
    const changed = patches.filter(({ id, patch }) => {
      const layer = currentDocument.current!.layers.find(item => item.id === id);
      return layer && Object.entries(patch).some(([key, value]) => {
        const previous = layer[key as keyof WatermarkLayer];
        return typeof previous === "number" && typeof value === "number" ? Math.abs(previous - value) > 1e-9 : previous !== value;
      });
    });
    if (!changed.length) return;
    updateDocument(draft => {
      for (const { id, patch } of changed) {
        const layer = draft.layers.find(item => item.id === id);
        if (layer) Object.assign(layer, patch);
      }
    }, record);
  }

  function addPhotos(next: PhotoAsset[], activate = true) {
    if (!next.length) return;
    const recovered = new Set(missingPhotos.map(item => item.path));
    next = next.map(photo => recovered.has(photo.path) ? { ...photo, overrides: restoredSession.current.overridesByPath?.[photo.path], crop: restoredSession.current.cropsByPath?.[photo.path] } : photo);
    setMissingPhotos(current => current.filter(item => !next.some(photo => photo.path === item.path)));
    const selectedTemplate = templates.find((template) => template.id === defaultTemplateId) ?? templates[0];
    setPhotos((current) => {
      const known = new Set(current.map((photo) => photo.path || photo.id));
      const combined = [...current, ...next.filter(photo => !known.has(photo.path || photo.id))];
      if (next.some(photo => recovered.has(photo.path))) {
        const order = new Map(restoredSession.current.paths.map((path, index) => [path, index]));
        combined.sort((a, b) => (order.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.path) ?? Number.MAX_SAFE_INTEGER));
      }
      return combined;
    });
    setDocuments((current) => {
      const result = { ...current };
      for (const photo of next) if (!result[photo.id]) result[photo.id] = recovered.has(photo.path) && restoredSession.current.documentsByPath?.[photo.path]
        ? cloneDocument(restoredSession.current.documentsByPath[photo.path])
        : selectedTemplate ? documentFromTemplate(selectedTemplate, photo) : createDefaultDocument();
      return result;
    });
    if (selectedTemplate) setTemplateByPhoto((current) => {
      const result = { ...current };
      for (const photo of next) if (!result[photo.id]) result[photo.id] = (recovered.has(photo.path) ? restoredSession.current.templateIdsByPath?.[photo.path] : undefined) ?? selectedTemplate.id;
      return result;
    });
    const toCheck = next.filter(photo => !recovered.has(photo.path) || restoredSession.current.checkedPaths?.includes(photo.path));
    setCheckedIds((current) => [...new Set([...current, ...toCheck.map(photo => photo.id)])]);
    if (activate) {
      setPhotoFilter(emptyPhotoFilter);
      setActiveId(next[0].id);
      setSelectedLayerIds([]);
    }
  }

  async function importNativePhotos(source: "files" | "folder" | string[]) {
    if (importBusy.current || loadState === "loading") return;
    importBusy.current = true;
    setMessage("");
    try {
      const dropped = Array.isArray(source);
      const defaultPath = lastImportDirectory.current ?? readImportDirectory();
      const selection = dropped ? source : source === "folder"
        ? await open({ directory: true, multiple: false, title: "选择照片文件夹", defaultPath })
        : await open({ multiple: true, directory: false, filters: [{ name: "摄影图片", extensions: imageExtensions }], defaultPath });
      const directory = selection && !dropped ? selectedImportDirectory(selection, source as "files" | "folder") : undefined;
      if (directory) {
        lastImportDirectory.current = directory;
        try { localStorage.setItem(importDirectoryKey, directory); storageError("importDirectory", ""); }
        catch { storageError("importDirectory", "最近导入目录暂未保存，本次仍会记住；重启后可能需要重新选择。"); }
      }
      if (!selection) return;
      setLoadState("loading");
      setMessage("正在查找照片…");
      const resolved = dropped ? await invoke<{ paths: string[]; failures: InspectReport["failures"]; ignored: number }>("resolve_photo_paths", { paths: source }) : null;
      const selectedPaths = resolved ? resolved.paths : source === "folder" && typeof selection === "string"
        ? await invoke<string[]>("list_image_files", { directory: selection })
        : selection ? (Array.isArray(selection) ? selection : [selection]) : [];
      if (!selectedPaths.length) {
        setLoadState("idle");
        setMessage(resolved?.failures.length ? `无法读取拖入项目：${resolved.failures[0].reason}` : "未找到 JPEG 或 PNG 照片");
        return;
      }
      const known = new Set(photos.map(photo => photo.path));
      const paths = [...new Set(selectedPaths)].filter(path => !known.has(path));
      if (!paths.length) {
        setLoadState("idle");
        setMessage("所选照片已在当前批次中");
        return;
      }
      setLoadState("loading");
      let imported = 0;
      let failed = resolved?.failures.length ?? 0;
      for (const [index, path] of paths.entries()) {
        setMessage(`正在导入 ${index + 1}/${paths.length} 张照片`);
        const report = await invoke<InspectReport>("inspect_images_resilient", { paths: [path] });
        addPhotos(report.items, imported === 0);
        imported += report.items.length;
        failed += report.failures.length;
      }
      setLoadState("idle");
      setMessage((failed
        ? `已导入 ${imported} 张，${failed} 张无法读取`
        : `已导入 ${imported} 张照片`) + (resolved?.ignored ? `，已忽略 ${resolved.ignored} 个不支持的文件` : ""));
    } catch (error) {
      setLoadState("error");
      setMessage(String(error));
    } finally {
      importBusy.current = false;
    }
  }

  async function importBrowserPhotos(selectedFiles: File[]) {
    const files = selectedFiles.filter(file => /\.(jpe?g|png)$/iu.test(file.name));
    if (selectedFiles.length && !files.length) { setMessage("请添加 JPEG 或 PNG 照片"); return; }
    if (!files.length || importBusy.current) return;
    importBusy.current = true;
    setLoadState("loading");
    try {
      let imported = 0;
      let failed = 0;
      const known = new Set(photos.map(photo => photo.id));
      for (const [index, file] of files.entries()) {
        const id = `browser-${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`;
        if (known.has(id)) continue;
        setMessage(`正在导入 ${index + 1}/${files.length} 张照片`);
        try {
          // Library thumbnails stay small; retain the compressed file so the
          // active editor can decode original detail on demand.
          const bitmap = await createImageBitmap(file);
          try {
            const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
            const preview = document.createElement("canvas");
            preview.width = Math.max(1, Math.round(bitmap.width * scale));
            preview.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = preview.getContext("2d");
            if (!context) throw new Error("无法生成缩略图");
            context.drawImage(bitmap, 0, 0, preview.width, preview.height);
            retainBrowserPhoto(id, file);
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
    }
  }

  function handleImport(source: "files" | "folder" = "files") {
    if (loadState === "loading") return;
    if (isNative) void importNativePhotos(source);
    else (source === "folder" ? folderInput : fileInput).current?.click();
  }

  const dropBlockedReason = !sessionReady || loadState === "loading" ? "正在读取照片，请稍后再拖入"
    : exportRunning || exportChecking ? "正在导出，请完成后再拖入"
    : showCrop || showExport || exportResult || showTemplateDialog || showTemplateManager || pendingRemoval || pendingRelink || pendingStorageRecovery ? "请先关闭弹窗，再拖入照片" : "";
  const photoDragging = usePhotoDrop({ native: isNative, blockedReason: dropBlockedReason,
    onPaths: paths => { void importNativePhotos(paths); },
    onFiles: files => { void importBrowserPhotos(files); }, onMessage: setMessage });

  function activatePhoto(id: string) {
    commitTransaction();
    setActiveId(id);
    currentDocument.current = documents[id];
    setSelectedLayerIds([]);
  }

  function toggleChecked(id: string) {
    setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function removePhotos(ids: string[], missingPaths: string[]) {
    const removed = new Set(ids);
    const remaining = photos.filter((photo) => !removed.has(photo.id));
    const removedPaths = new Set([...missingPaths, ...photos.filter(photo => removed.has(photo.id)).map(photo => photo.path)]);
    const saved = structuredClone(restoredSession.current);
    saved.paths = saved.paths.filter(path => !removedPaths.has(path));
    saved.checkedPaths = saved.checkedPaths?.filter(path => !removedPaths.has(path));
    if (saved.activePath && removedPaths.has(saved.activePath)) saved.activePath = "";
    for (const key of ["documentsByPath", "overridesByPath", "templateIdsByPath", "dimensionsByPath", "cropsByPath"] as const) {
      for (const path of removedPaths) if (saved[key]) delete saved[key][path];
    }
    restoredSession.current = saved;
    setMissingPhotos(current => current.filter(photo => !removedPaths.has(photo.path)));
    for (const id of removed) releaseBrowserPhoto(id);
    setPhotos(remaining);
    if (!remaining.length) setPhotoFilter(emptyPhotoFilter);
    setCheckedIds((current) => current.filter((id) => !removed.has(id)));
    setTemplateByPhoto((current) => {
      const next = { ...current };
      for (const id of removed) delete next[id];
      return next;
    });
    setDocuments((current) => {
      const next = { ...current };
      for (const id of removed) delete next[id];
      return next;
    });
    if (removed.has(activeId)) {
      const firstRemovedIndex = photos.findIndex((photo) => removed.has(photo.id));
      const nextPhoto = remaining.find((photo) => photos.indexOf(photo) > firstRemovedIndex) ?? remaining[remaining.length - 1];
      setActiveId(nextPhoto?.id ?? "");
      setSelectedLayerIds([]);
    }
    clearHistory();
    setMessage(`已从当前批次移除 ${removed.size + missingPaths.length} 张照片，原图未删除`);
    setPendingRemoval(null);
  }

  function applyTemplate(template: TemplateRecord, targetIds: string[]) {
    pushHistory(captureHistory(targetIds));
    if (activePhoto && targetIds.includes(activeId)) currentDocument.current = documentFromTemplate(template, activePhoto);
    setDocuments((current) => {
      const next = { ...current };
      for (const id of targetIds) {
        const photo = photos.find((item) => item.id === id);
        if (!photo) continue;
        next[id] = documentFromTemplate(template, photo);
      }
      return next;
    });
    setTemplateByPhoto((current) => ({ ...current, ...Object.fromEntries(targetIds.map((id) => [id, template.id])) }));
    setSelectedLayerIds([]);
    setMessage(`已应用“${template.name}”到 ${targetIds.length} 张照片`);
  }

  function applyCurrentCanvas(targetIds: string[]) {
    const source = currentDocument.current ?? activeDocument;
    if (!source) return;
    const validIds = new Set(photos.map((photo) => photo.id));
    pushHistory(captureHistory(targetIds));
    setDocuments((current) => {
      const next = { ...current };
      for (const id of targetIds) {
        if (validIds.has(id)) next[id] = cloneDocument(source);
      }
      return next;
    });
    if (activeId && targetIds.includes(activeId)) currentDocument.current = cloneDocument(source);
    setTemplateByPhoto((current) => ({ ...current, ...Object.fromEntries(targetIds.filter((id) => validIds.has(id)).map((id) => [id, activeTemplate])) }));
    setSelectedLayerIds([]);
    setMessage(`已将当前画布应用到 ${targetIds.length} 张照片`);
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
    if (!activePhoto || !activeDocument) return;
    const issue = templateNameError(templateName, templates);
    if (issue) { setMessage(issue); return; }
    const orientation: Orientation = photoOrientation(activePhoto);
    const template: TemplateRecord = {
      id: `template-${crypto.randomUUID()}`,
      name: templateName.trim(),
      description: `${orientation === "landscape" ? "横图" : "竖图"}布局，自定义模板`,
      builtIn: false,
      cover: activePhoto.thumbnailDataUrl,
      layouts: { [orientation]: cloneDocument(activeDocument) },
      updatedAt: Date.now(),
    };
    setTemplates((current) => [...current, template]);
    setTemplateByPhoto((current) => ({ ...current, [activeId]: template.id }));
    setShowTemplateDialog(false);
    setTemplateName("");
    setMessage(`已保存新模板“${template.name}”`);
  }

  function renameTemplate(id: string, name: string) {
    const issue = templateNameError(name, templates, id);
    if (issue) { setMessage(issue); return; }
    setTemplates((current) => current.map((template) => template.id === id ? { ...template, name, updatedAt: Date.now() } : template));
    setMessage(`已重命名模板“${name}”`);
  }

  function duplicateTemplate(id: string) {
    const source = templates.find((template) => template.id === id);
    if (!source) return;
    const name = copyTemplateName(source.name, templates);
    setTemplates((current) => [...current, { ...structuredClone(source), id: `template-${crypto.randomUUID()}`, name, builtIn: false, updatedAt: Date.now() }]);
    setMessage(`已复制模板“${name}”`);
  }

  function deleteTemplate(id: string) {
    setTemplates((current) => current.filter((template) => template.id !== id));
    if (defaultTemplateId === id) setDefaultTemplateId(builtInDefaultTemplateId());
    setTemplateByPhoto((current) => Object.fromEntries(Object.entries(current).filter(([, templateId]) => templateId !== id)));
    setMessage("已删除模板，已套用到照片的内容保持不变");
  }

  function resetTemplate(id: string) {
    const original = builtInTemplates().find((template) => template.id === id);
    if (!original) return;
    setTemplates((current) => current.map((template) => template.id === id ? original : template));
    setMessage(`已重置“${original.name}”，现有照片保持不变`);
  }

  function restoreTemplates(decisions: ImportDecision[], backupDefaultId: string, restoreDefault: boolean) {
    const result = importTemplates(templates, decisions);
    setTemplates(result.templates);
    if (restoreDefault && result.idMap[backupDefaultId]) setDefaultTemplateId(result.idMap[backupDefaultId]);
    setMessage(`已导入 ${result.imported} 个模板`);
  }

  function addLayer(source: LayerSource) {
    if ((activeDocument?.layers.length ?? 0) >= 100) { setMessage("每张照片最多支持 100 个文字图层"); return; }
    const added = nextLayer(source, activeDocument?.layers.length ?? 0);
    updateDocument((draft) => { draft.layers.push(added); });
    setSelectedLayerIds([added.id]);
    setInspectorTab("watermark");
  }

  function deleteSelectedLayers() {
    if (!selectedLayers.length) return;
    updateDocument(draft => { draft.layers = draft.layers.filter(item => !selectedLayerIds.includes(item.id)); });
    setSelectedLayerIds([]);
  }

  function updatePhotoOverride(source: LayerSource, value?: string) {
    if (!activePhoto || source === "custom" || activePhoto.overrides?.[source] === value) return;
    pushHistory(captureHistory([activePhoto.id]));
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
    if (exportBusy.current) return;
    const plan = buildExportPlan({ photos, documents, activeId, checkedIds, settings: exportSettings, templates, templateByPhoto });
    const retry = retryPaths && lastExportRequest.current
      ? retryExportRequest(lastExportRequest.current, retryPaths) : null;
    const request = retry ?? createExportRequest(plan.items, exportSettings);
    if (retry) plan.issues = request.items.length ? [] : [{ field: "range", message: "没有可重试的失败项" }];
    setExportIssues(plan.issues);
    if (plan.issues.length) {
      setShowExport(true);
      setMessage(plan.issues[0].message);
      return;
    }
    if (!isNative) {
      closeExport();
      setMessage("导出设置已保存");
      return;
    }
    exportBusy.current = true;
    setExportChecking(true);
    let preflight: ExportPreflight;
    try {
      preflight = await invoke<ExportPreflight>("preflight_export", { request });
    } catch (error) {
      const message = `预检失败：${String(error)}`;
      setExportIssues([{ field: "preflight", message }]);
      setShowExport(true);
      setMessage(message);
      setExportChecking(false);
      exportBusy.current = false;
      return;
    }
    if (!preflight.ready) {
      setExportIssues(preflight.errors.map((message) => ({ field: "preflight", message })));
      setShowExport(true);
      setMessage(preflight.errors[0] ?? "导出预检未通过");
      setExportChecking(false);
      exportBusy.current = false;
      return;
    }
    setExportChecking(false);
    closeExport();
    setExportResult(null);
    lastExportRequest.current = request;
    const startedAt = performance.now();
    setExportStartedAt(startedAt);
    setExportRunning(true);
    setExportCancelling(false);
    setExportProgress({ current: 1, completed: 0, total: request.items.length, fileName: "准备导出", succeeded: 0, failed: 0, skipped: 0, stage: "preflight" });
    try {
      const result = await invoke<ExportSummary>("export_images", { request });
      const warnings = [...new Set([...preflight.warnings, ...result.warnings])];
      setExportResult({ ...result, elapsedMs: result.elapsedMs ?? performance.now() - startedAt, warnings });
      setMessage(result.cancelled ? "导出已取消，已完成的文件会保留" : `导出完成：成功 ${result.succeeded} 张`);
    } catch (error) {
      setExportResult({ elapsedMs: performance.now() - startedAt, total: request.items.length, succeeded: 0, failed: request.items.length, skipped: 0, cancelled: false, outputDirectory: request.settings.directory, failures: [{ fileName: "导出任务", path: "", reason: String(error) }], warnings: preflight.warnings });
      setMessage(`导出失败：${String(error)}`);
    } finally {
      exportBusy.current = false;
      setExportRunning(false);
      setExportCancelling(false);
    }
  }

  async function cancelExport() {
    if (!isNative || exportCancelling) return;
    setExportCancelling(true);
    try {
      await invoke("cancel_export");
    } catch (error) {
      setExportCancelling(false);
      setMessage(`取消失败：${String(error)}`);
    }
  }

  function closeExport() {
    if (exportChecking) return;
    setShowExport(false);
    setExportIssues([]);
  }

  function openExport(range: ExportSettings["range"]) {
    setExportSettings((current) => ({ ...current, range }));
    setExportIssues([]);
    setShowExport(true);
  }

  const exportPlan = useMemo(() => buildExportPlan({
    photos,
    documents,
    activeId,
    checkedIds,
    settings: exportSettings,
    templates,
    templateByPhoto,
  }), [activeId, checkedIds, documents, exportSettings, photos, templates, templateByPhoto]);
  const hiddenExportCount = filtersActive ? exportPlan.items.filter(item => !visiblePhotoPaths.has(item.path)).length : 0;
  const visibleExportIssues = [
    ...exportPlan.issues,
    ...exportIssues.filter((issue) => issue.field === "preflight"),
  ];

  const activeTemplateRecord = templates.find((item) => item.id === activeTemplate);

  return (
    <div className={`app-shell ${isNative ? "native-window" : ""}`} onKeyDown={event => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (showCrop || showExport || showTemplateDialog || showTemplateManager || pendingRemoval || pendingRelink || pendingStorageRecovery || exportRunning || exportResult) return;
      if (editorRef.current?.isInteracting()) return;
      const command = event.ctrlKey || event.metaKey;
      const rangeUndo = target.closest('input[type="range"]') && command && ["z", "y"].includes(event.key.toLowerCase());
      if (target.closest("input, textarea, select, [role=combobox], [contenteditable=true]") && !rangeUndo) return;
      if (rangeUndo) commitTransaction();
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (command && event.key.toLowerCase() === "a" && activeDocument) {
        event.preventDefault(); setSelectedLayerIds(activeDocument.layers.filter(layer => isVisible(layer, activeDocument.regions)).map(layer => layer.id)); setInspectorTab("watermark"); return;
      }
      if (event.key === "Escape") { setSelectedLayerIds([]); return; }
      if (!selectedLayers.length || command || event.altKey) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelectedLayers(); return; }
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (direction && activePhoto && activeDocument) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1;
        updateLayers(moveSelection(selectedLayers.filter(layer => isVisible(layer, activeDocument.regions)), calculateGeometry(activePhoto, activeDocument), { x: direction[0] * step, y: direction[1] * step }));
      }
    }}>
      {photoDragging && <div className="photo-drop-overlay" role="status"><div><ImageSquare aria-hidden="true" /><strong>{dropBlockedReason || "松开鼠标，导入照片"}</strong><span>{isNative ? "支持 JPEG / PNG，也可拖入文件夹" : "支持 JPEG / PNG，可一次拖入多张"}</span></div></div>}
      <WindowChrome enabled={isNative} />
      <header className="app-header" data-window-drag={isNative ? "" : undefined}>
        <input ref={fileInput} className="visually-hidden" type="file" aria-label="选择照片文件" accept="image/jpeg,image/png" multiple onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void importBrowserPhotos(files); }} />
        <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" aria-label="选择照片文件夹" accept="image/jpeg,image/png" multiple onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void importBrowserPhotos(files); }} />
        <div className="brand-block"><span className="brand-mark"><FrameCorners weight="bold" /></span><h1>映框</h1></div>
        <div className="project-title"><strong title={activePhoto?.fileName}>{activePhoto?.fileName ?? "未导入照片"}</strong></div>
        <div className="header-actions">
          <button className="icon-button" type="button" aria-label="撤销" disabled={!canUndo} onClick={undo}><ArrowCounterClockwise /></button>
          <button className="icon-button" type="button" aria-label="重做" disabled={!canRedo} onClick={redo}><ArrowClockwise /></button>
          <span className="header-divider" />
          <button className="button secondary" type="button" onClick={() => setShowTemplateManager(true)}><Stack /> 模板库</button>
          <button className="button secondary" type="button" onClick={() => openExport("current")} disabled={!activePhoto}><ImageSquare /> 导出当前</button>
          <button className="button primary" type="button" onClick={() => openExport(exportSettings.range === "current" ? "selected" : exportSettings.range)} disabled={!photos.length}><DownloadSimple /> 批量导出</button>
        </div>
      </header>

      <main className="workbench">
        <aside className="library-panel" aria-label="照片批次">
          <div className="panel-heading library-heading">
            <div><span>当前工作集</span><strong>照片 <em>{photos.length}</em></strong></div>
          </div>
          <div className="library-controls">
            <div className="library-import-actions">
              <button className="button secondary" type="button" onClick={() => handleImport()} disabled={loadState === "loading"}><Plus /> 添加照片</button>
              <button className="button secondary" type="button" onClick={() => handleImport("folder")} disabled={loadState === "loading"}><FolderOpen /> 导入文件夹</button>
            </div>
            <p className="library-drop-hint">{isNative ? "也可将照片或文件夹拖入窗口" : "也可将照片拖入窗口"}</p>
            <label className="library-template-select"><span>新照片使用模板</span><SelectControl aria-label="新照片使用模板" value={defaultTemplateId} onChange={(event) => setDefaultTemplateId(event.currentTarget.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</SelectControl><small>仅影响之后导入的照片</small></label>
            {!!photos.length && <details className="photo-filters">
              <summary>查找与筛选{filtersActive ? ` · ${visiblePhotos.length}/${photos.length}` : ""}</summary>
              <div className="photo-filter-fields">
                <label>文件名<input type="search" aria-label="搜索照片文件名" placeholder="输入文件名" value={photoFilter.query} onChange={event => { const query = event.currentTarget.value; setPhotoFilter(current => ({ ...current, query })); }} /></label>
                <label>方向<SelectControl aria-label="筛选照片方向" value={photoFilter.direction} onChange={event => { const direction = event.currentTarget.value as PhotoDirection; setPhotoFilter(current => ({ ...current, direction })); }}><option value="all">全部方向</option><option value="landscape">横图</option><option value="portrait">竖图</option><option value="square">方图</option></SelectControl></label>
              </div>
            </details>}
            {filtersActive && <div className="photo-filter-status"><p role="status">显示 {visiblePhotos.length} / {photos.length} 张{activePhoto && !visiblePhotoIds.has(activePhoto.id) ? "，当前编辑照片在筛选外" : ""}</p><button type="button" onClick={() => setPhotoFilter(emptyPhotoFilter)}>清除筛选</button></div>}
            <div className="photo-selection-summary"><strong>已勾选 {selectedCount} / {photos.length}</strong><span>{hiddenSelectedCount ? `含筛选外 ${hiddenSelectedCount} 张` : "用于批量应用与导出"}</span></div>
            <div className="photo-selection-actions" role="group" aria-label="照片批量选择">
              <button type="button" disabled={!visiblePhotos.length} onClick={() => setCheckedIds(current => selectVisiblePhotos(current, visiblePhotos.map(photo => photo.id), "all"))}>{filtersActive ? "全选结果" : "全选"}</button>
              <button type="button" disabled={!visiblePhotos.length} onClick={() => setCheckedIds(current => selectVisiblePhotos(current, visiblePhotos.map(photo => photo.id), "invert"))}>{filtersActive ? "反选结果" : "反选"}</button>
              <button type="button" disabled={!visibleSelectedCount} onClick={() => setCheckedIds(current => selectVisiblePhotos(current, visiblePhotos.map(photo => photo.id), "none"))}>{filtersActive ? "取消结果" : "取消选择"}</button>
            </div>
            {activeDocument && checkedIds.some((id) => id !== activeId) && <button className="library-batch-button" type="button" onClick={() => applyCurrentCanvas(checkedIds)}>将当前画布应用到已勾选 {selectedCount} 张</button>}
            {Object.values(storageErrors).some(Boolean) && <div className="storage-notice" role="alert">{Object.entries(storageErrors).filter(([, error]) => error).map(([scope, error]) => <div key={scope}><p>{error}</p>{isNative && (scope === "session" || scope === "templates") && <button className="button secondary" type="button" disabled={!sessionReady || loadState === "loading"} onClick={() => beginStorageRecovery(scope)}>备份并恢复{scope === "session" ? "工作记录" : "模板库"}</button>}{scope === "defaultTemplate" && <button className="button secondary" type="button" onClick={retryDefaultTemplateSave}>重试保存默认模板</button>}</div>)}</div>}
            {!!missingPhotos.length && <details className="missing-photos"><summary>{missingPhotos.length} 张原图暂不可用，编辑已保留</summary><p>选择移动后的原图，或恢复原路径后重新导入。</p>{missingPhotos.map(item => <div key={item.path}><strong>{item.path.split(/[\\/]/).pop()}</strong><small title={item.path}>{item.path}</small><small>{item.reason}</small><button className="button secondary" type="button" disabled={loadState === "loading"} aria-label={`重新定位 ${item.path.split(/[\\/]/).pop()}`} onClick={() => void selectReplacementPhoto(item.path)}><FolderOpen /> 重新定位原图</button><button className="button secondary" type="button" disabled={loadState === "loading"} aria-label={`移除缺失记录 ${item.path.split(/[\\/]/).pop()}`} onClick={() => setPendingRemoval({ ids: [], missingPaths: [item.path] })}>移除记录</button>{relinkError?.path === item.path && <small className="field-message" role="alert">{relinkError.message}</small>}</div>)}</details>}
          </div>
          <div className="photo-list">
            {!photos.length ? (
              <button className="library-empty" type="button" onClick={() => handleImport()}><ImageSquare /><strong>还没有照片</strong><span>添加照片或导入整个文件夹</span></button>
            ) : !visiblePhotos.length ? <div className="photo-filter-empty"><strong>没有匹配的照片</strong><p>试试缩短文件名，或清除方向筛选。</p></div> : visiblePhotos.map((photo) => (
              <div key={photo.id} className={`photo-row ${photo.id === activePhoto?.id ? "active" : ""} ${checkedSet.has(photo.id) ? "checked" : ""}`}>
                <button type="button" className="photo-check-button" aria-label={`${checkedSet.has(photo.id) ? "取消勾选" : "勾选"} ${photo.fileName}`} aria-pressed={checkedSet.has(photo.id)} onClick={() => toggleChecked(photo.id)}><span className="check-control">{checkedSet.has(photo.id) && <Check weight="bold" />}</span></button>
                <button type="button" className="photo-open-button" aria-label={`预览 ${photo.fileName}`} aria-current={photo.id === activePhoto?.id ? "true" : undefined} onClick={() => activatePhoto(photo.id)}><img src={photo.thumbnailDataUrl} alt="" /><span className="photo-row-copy"><strong title={photo.fileName}>{photo.fileName}</strong><small>{formatPixels(photo)}</small></span></button>
              </div>
            ))}
          </div>
          <div className="library-footer">
            <button className="library-remove-button" type="button" disabled={!selectedCount || loadState === "loading" || exportRunning} onClick={() => setPendingRemoval({ ids: checkedIds, missingPaths: [] })}><Trash /> 移除已选</button>
            <button className="library-clear-button" type="button" disabled={(!photos.length && !missingPhotos.length) || loadState === "loading" || exportRunning} onClick={() => setPendingRemoval({ ids: photos.map(photo => photo.id), missingPaths: missingPhotos.map(photo => photo.path) })}>清空批次</button>
          </div>
        </aside>

        <section className="editor-panel">
          <EditorWorkspace photo={activePhoto} document={activeDocument} loading={loadState === "loading"} onImport={() => handleImport()} onCrop={() => { commitTransaction(); setShowCrop(true); }} onToggleSnap={() => setSnapEnabled(value => !value)} editorRef={editorRef} selectedLayerIds={selectedLayerIds} snapEnabled={snapEnabled} onSelectionChange={(ids) => { setSelectedLayerIds(ids); if (ids.length) setInspectorTab("watermark"); }} onLayersCommit={updateLayers} />

          <div className={`status-bar ${loadState === "error" ? "error" : ""}`}><span>{message || (selectedLayers.length ? `已选：${selectedLayers.length === 1 ? selectedLayers[0].name : `${selectedLayers.length} 个元素`}` : activePhoto ? `${activePhoto.fileName}  ${activePhoto.megapixels.toFixed(1)} MP` : "准备就绪")}</span><span>{activePhoto ? `${formatPixels(activePhoto)}  sRGB  预览` : "完全本地处理"}</span></div>
        </section>

        <aside className="inspector-panel" aria-label="编辑参数">
          <div className="inspector-tabs" role="tablist" aria-label="编辑工具" onKeyDown={(event) => {
            const tabs: InspectorTab[] = ["template", "frame", "watermark"];
            const index = tabs.indexOf(inspectorTab);
            const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
              : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length]
                : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
            if (next) { event.preventDefault(); setInspectorTab(next); document.getElementById(`tab-${next}`)?.focus(); }
          }}>
            <button id="tab-template" role="tab" aria-selected={inspectorTab === "template"} tabIndex={inspectorTab === "template" ? 0 : -1} type="button" className={inspectorTab === "template" ? "active" : ""} onClick={() => setInspectorTab("template")}><Stack /> 模板</button>
            <button id="tab-frame" role="tab" aria-selected={inspectorTab === "frame"} tabIndex={inspectorTab === "frame" ? 0 : -1} type="button" className={inspectorTab === "frame" ? "active" : ""} onClick={() => setInspectorTab("frame")}><FrameCorners /> 相框</button>
            <button id="tab-watermark" role="tab" aria-selected={inspectorTab === "watermark"} tabIndex={inspectorTab === "watermark" ? 0 : -1} type="button" className={inspectorTab === "watermark" ? "active" : ""} onClick={() => setInspectorTab("watermark")}><TextT /> 水印</button>
          </div>
          {inspectorTab === "template" ? (
            <div className="inspector-scroll" id="panel-template" role="tabpanel" aria-labelledby="tab-template">
              <section className="inspector-section template-section">
                <div className="section-heading"><strong>选择模板</strong><button className="template-manage-link" type="button" onClick={() => setShowTemplateManager(true)}>管理模板库</button></div>
                <p className="section-help">{activePhoto ? "选择后套用到当前照片。新照片默认模板在左侧设置。" : "点击模板可设置新照片的默认样式。"}</p>
                <div className="template-list">{templates.map((template) => <button className={`template-card ${activeTemplate === template.id ? "active" : ""}`} type="button" key={template.id} onClick={() => activeId ? applyTemplate(template, [activeId]) : setDefaultTemplateId(template.id)}><TemplatePreview template={template} photo={activePhoto} /><span className="template-card-copy"><strong>{template.name}</strong><small>{template.description}</small></span><span className="template-card-state">{activeTemplate === template.id ? activePhoto ? "重新套用" : "新照片默认" : activePhoto ? "套用" : "设为默认"}</span></button>)}</div>
                {activePhoto && <><p className="template-source-note">当前照片基于“{activeTemplateRecord?.name ?? "已删除的模板"}”。画布调整仅影响这张照片。</p><div className="template-actions"><button type="button" disabled={!activeTemplateRecord} onClick={updateCurrentTemplate}><FloppyDisk /> 更新原模板</button><button type="button" onClick={() => { setTemplateName(`${activeTemplateRecord?.name ?? "相框"} 副本`); setShowTemplateDialog(true); }}><Copy /> 另存为模板</button></div></>}
              </section>
            </div>
          ) : activeDocument && inspectorTab === "frame" ? (
            <div className="inspector-scroll" id="panel-frame" role="tabpanel" aria-labelledby="tab-frame">
              <section className="inspector-section">
                <div className="section-heading"><strong>相框外观</strong><span>实时预览</span></div>
                <Segmented label="相框类型" value={activeDocument.frame.type} options={[{ value: "blur", label: "照片模糊" }, { value: "solid", label: "纯色" }]} onChange={(value) => updateDocument((draft) => { draft.frame.type = value; })} />
                {activeDocument.frame.type === "blur" ? <><SliderRow label="模糊程度" value={activeDocument.frame.blur} min={0} max={70} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.blur = value; }, false)} /><SliderRow label="背景亮度" value={activeDocument.frame.brightness} min={30} max={130} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.brightness = value; }, false)} /></> : <label className="field color-field"><span>相框颜色</span><span className="color-input-wrap"><input type="color" value={activeDocument.frame.color} onChange={(event) => { const color = event.currentTarget.value; updateDocument((draft) => { draft.frame.color = color; }); }} /><code>{activeDocument.frame.color.toUpperCase()}</code></span></label>}
              </section>
              <section className="inspector-section">
                <div className="section-heading"><strong>照片与基础留白</strong><span>相对成品短边</span></div>
                <SliderRow label="左右基础留白" value={activeDocument.frame.paddingX} min={0} max={20} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.paddingX = value; }, false)} /><SliderRow label="上下基础留白" value={activeDocument.frame.paddingY} min={0} max={20} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.paddingY = value; }, false)} /><SliderRow label="照片圆角" value={activeDocument.frame.radius} min={0} max={32} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.radius = value; }, false)} /><SliderRow label="照片阴影" value={activeDocument.frame.shadow} min={0} max={100} onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.frame.shadow = value; }, false)} />
              </section>
              <section className="inspector-section">
                <div className="section-heading"><strong>四边参数区</strong><span>可同时开启</span></div><p className="section-help">上下区域占整宽，左右区域只占照片高度。区域尺寸同样按成品短边计算。</p>
                <div className="region-grid">{(Object.keys(regionLabels) as Array<Exclude<RegionId, "canvas">>).map((regionId) => { const settings = activeDocument.regions[regionId]; return <button type="button" className={settings.enabled ? "enabled" : ""} key={regionId} onClick={() => updateDocument((draft) => { draft.regions[regionId].enabled = !settings.enabled; })}><span>{regionLabels[regionId]}</span><small>{settings.enabled ? `${settings.extra}%` : "关闭"}</small></button>; })}</div>
                {(Object.keys(regionLabels) as Array<Exclude<RegionId, "canvas">>).filter((id) => activeDocument.regions[id].enabled).map((regionId) => <SliderRow key={regionId} label={`${regionLabels[regionId]}区额外空间`} value={activeDocument.regions[regionId].extra} min={0} max={30} suffix="%" onStart={beginTransaction} onEnd={commitTransaction} onChange={(value) => updateDocument((draft) => { draft.regions[regionId].extra = value; }, false)} />)}
              </section>
            </div>
          ) : activeDocument ? (
            <LayerInspector document={activeDocument} photo={activePhoto} selectedIds={selectedLayerIds}
              onSelect={(id, extend) => setSelectedLayerIds(current => selectLayer(current, id, extend))}
              onSelectionChange={setSelectedLayerIds} onPatch={updateLayers} onAdd={addLayer} onDelete={deleteSelectedLayers}
              onStart={beginTransaction} onEnd={commitTransaction} onOverride={updatePhotoOverride}
              onArrange={(action, reference) => editorRef.current?.arrange(action, reference)} />
          ) : <div className="inspector-empty" id={`panel-${inspectorTab}`} role="tabpanel" aria-labelledby={`tab-${inspectorTab}`}>导入照片后开始设置</div>}
        </aside>
      </main>

      {showTemplateManager && <TemplateManager templates={templates} defaultTemplateId={defaultTemplateId} photo={activePhoto} onClose={() => setShowTemplateManager(false)} onDefaultChange={setDefaultTemplateId} onRename={renameTemplate} onDuplicate={duplicateTemplate} onDelete={deleteTemplate} onReset={resetTemplate} onImport={restoreTemplates} />}

      {pendingStorageRecovery && <StorageRecoveryDialog recovery={pendingStorageRecovery} onClose={() => setPendingStorageRecovery(null)} onRecovered={storageRecovered} />}

      {pendingRelink && <Modal onClose={() => setPendingRelink(null)}><section className="compact-dialog relink-dialog" role="dialog" aria-modal="true" aria-labelledby="relink-title">
        <div className="compact-dialog-header"><div><span>恢复编辑</span><h2 id="relink-title">确认原图的新位置</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setPendingRelink(null)}><X /></button></div>
        <div className="compact-dialog-body"><img className="relink-preview" src={pendingRelink.photo.thumbnailDataUrl} alt="所选照片预览" /><p>原路径：<span className="relink-path">{pendingRelink.oldPath}</span></p><p>新路径：<span className="relink-path">{pendingRelink.photo.path}</span></p><p>新照片尺寸：{formatPixels(pendingRelink.photo)} px</p>
          {restoredSession.current.dimensionsByPath?.[pendingRelink.oldPath] && <p>原照片尺寸：{restoredSession.current.dimensionsByPath[pendingRelink.oldPath].width} × {restoredSession.current.dimensionsByPath[pendingRelink.oldPath].height} px</p>}
          <p>确认这是原来的照片。原排版、裁切、手动文字与勾选状态将保留；如果照片经过裁剪或旋转，请检查裁切区域和水印位置。</p>
        </div><footer><button data-modal-initial className="button secondary" type="button" onClick={() => setPendingRelink(null)}>取消</button><button className="button primary" type="button" onClick={confirmReplacementPhoto}>使用此照片恢复</button></footer>
      </section></Modal>}

      {pendingRemoval && <Modal onClose={() => setPendingRemoval(null)}><section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title"><div className="compact-dialog-header"><div><span>照片批次</span><h2 id="remove-title">移除 {pendingRemoval.ids.length + pendingRemoval.missingPaths.length} 张照片？</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setPendingRemoval(null)}><X /></button></div><div className="compact-dialog-body"><p>照片只会从当前批次移除，磁盘上的原图不会删除。这些照片在当前批次中的单独调整也会清除。</p>{pendingHiddenCount > 0 && <p>其中 {pendingHiddenCount} 张照片在当前筛选结果之外。</p>}{!!pendingRemoval.missingPaths.length && <p>包括 {pendingRemoval.missingPaths.length} 张缺失原图的编辑记录；移除后无法通过重新定位找回这些调整。</p>}</div><footer><button className="button secondary" type="button" onClick={() => setPendingRemoval(null)}>取消</button><button className="button primary" type="button" onClick={() => removePhotos(pendingRemoval.ids, pendingRemoval.missingPaths)}>确认移除</button></footer></section></Modal>}

      {showTemplateDialog && <Modal onClose={() => setShowTemplateDialog(false)}><section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title"><div className="compact-dialog-header"><div><span>模板库</span><h2 id="template-title">另存为新模板</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowTemplateDialog(false)}><X /></button></div><div className="compact-dialog-body"><label className="field"><span>模板名称</span><input autoFocus className="text-input" maxLength={maxTemplateNameLength} value={templateName} onChange={(event) => setTemplateName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") saveNewTemplate(); }} /></label>{templateName && templateNameError(templateName, templates) && <p role="alert">{templateNameError(templateName, templates)}</p>}<p>保存当前方向的相框、四边区域、水印字段、字体和位置，并使用当前照片更新封面。</p></div><footer><button className="button secondary" type="button" onClick={() => setShowTemplateDialog(false)}>取消</button><button className="button primary" type="button" disabled={!!templateNameError(templateName, templates)} onClick={saveNewTemplate}>保存模板</button></footer></section></Modal>}

      {showExport && (
        <Modal onClose={exportChecking ? undefined : closeExport}>
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" aria-busy={exportChecking}>
            <div className="export-dialog-header"><div><span>{exportSettings.range === "current" ? "单张导出" : "批量导出"}</span><h2 id="export-title">导出 {exportPlan.items.length} 张照片</h2></div><button data-export-close className="icon-button" type="button" aria-label="关闭" disabled={exportChecking} onClick={closeExport}><X /></button></div>
            <div className="export-body" ref={exportBody}>
              <fieldset className="export-main" disabled={exportChecking}>
                <section className="export-section">
                  <h3>输出位置与范围</h3>
                  <Segmented label="导出范围" value={exportSettings.range} options={[{ value: "current", label: "当前" }, { value: "selected", label: `已选 ${selectedCount}` }, { value: "all", label: `全部 ${photos.length}` }]} onChange={(range) => setExportSettings((value) => ({ ...value, range }))} />
                  {hiddenExportCount > 0 && <p className="export-filter-notice">本次包括筛选结果之外的 {hiddenExportCount} 张照片；筛选仅改变列表显示。</p>}
                  <label className={`field ${exportPlan.issues.some((issue) => issue.field === "directory") ? "field-error" : ""}`}><span>输出文件夹</span><button className="directory-picker" type="button" aria-label="选择输出文件夹" aria-describedby={exportDirectoryId} title={exportSettings.directory || undefined} onClick={() => void selectOutputDirectory()}><FolderOpen /><span id={exportDirectoryId}>{exportSettings.directory || "选择本地文件夹"}</span></button></label>
                </section>
                <section className="export-section">
                  <h3>文件与尺寸</h3>
                  <div className="export-grid">
                    <label className="field"><span>格式</span><SelectControl aria-label="格式" value={exportSettings.format} onChange={(event) => { const format = event.currentTarget.value as "jpeg" | "png"; setExportSettings((value) => ({ ...value, format })); }}><option value="jpeg">JPEG</option><option value="png">PNG</option></SelectControl></label>
                    <label className="field"><span>成品尺寸</span><SelectControl aria-label="成品尺寸" value={exportSettings.size} onChange={(event) => { const size = event.currentTarget.value as "original" | "long-edge"; setExportSettings((value) => ({ ...value, size })); }}><option value="original">保持主照片像素</option><option value="long-edge">指定成品长边</option></SelectControl></label>
                  </div>
                  {exportSettings.size === "long-edge" && <label className={`field ${exportPlan.issues.some((issue) => issue.field === "longEdge") ? "field-error" : ""}`}><span>成品长边像素</span><input className="text-input" type="number" min="800" max="30000" step="1" value={exportSettings.longEdge} aria-invalid={exportPlan.issues.some((issue) => issue.field === "longEdge")} onChange={(event) => { const longEdge = Number(event.currentTarget.value); setExportSettings((value) => ({ ...value, longEdge })); }} />{exportPlan.issues.filter((issue) => issue.field === "longEdge").map((issue) => <small className="field-message" key={issue.message}>{issue.message}</small>)}</label>}
                  {exportSettings.size === "long-edge" && <label className="check-field"><input type="checkbox" checked={exportSettings.noUpscale} onChange={event => { const noUpscale = event.currentTarget.checked; setExportSettings(value => ({ ...value, noUpscale })); }} /><span><strong>不放大小图</strong><small>主照片保持原像素或缩小，含边框的成品不超过指定长边</small></span></label>}
                  {exportSettings.format === "jpeg" ? (
                    <SliderRow label="JPEG 质量" value={exportSettings.quality} min={1} max={100} onChange={(quality) => setExportSettings((value) => ({ ...value, quality }))} />
                  ) : (
                    <Segmented label="PNG 压缩" value={exportSettings.pngCompression} options={[{ value: "fast", label: "快速" }, { value: "standard", label: "标准" }, { value: "small", label: "更小" }]} onChange={(pngCompression) => setExportSettings((value) => ({ ...value, pngCompression }))} />
                  )}
                  <label className="check-field"><input type="checkbox" checked={exportSettings.suffixMode === "template"} onChange={event => { const suffixMode = event.currentTarget.checked ? "template" : "custom"; setExportSettings(value => ({ ...value, suffixMode })); }} /><span>使用相框名称</span></label>
                  <div className="export-grid">
                    <label className={`field ${exportPlan.issues.some((issue) => issue.field === "suffix") ? "field-error" : ""}`}>
                      <span>文件名后缀</span>
                      <input className="text-input" readOnly={exportSettings.suffixMode === "template"} value={exportSettings.suffixMode === "template" ? exportPlan.items[0]?.outputSuffix ?? "-相框" : exportSettings.suffix} aria-invalid={exportPlan.issues.some((issue) => issue.field === "suffix")} onChange={event => { const suffix = event.currentTarget.value; setExportSettings(value => ({ ...value, suffix })); }} />
                      <small className="field-hint">{exportSettings.suffixMode === "template" ? "按每张照片的模板命名；保留字符替换为下划线，过长名称自动截短" : "可留空；不能含 /、\\ 或系统保留字符"}</small>
                      {exportPlan.issues.filter((issue) => issue.field === "suffix").map((issue) => <small className="field-message" key={issue.message}>{issue.message}</small>)}
                    </label>
                    <label className="field"><span>重名处理</span><SelectControl aria-label="重名处理" value={exportSettings.collision} onChange={(event) => { const collision = event.currentTarget.value as ExportSettings["collision"]; setExportSettings((value) => ({ ...value, collision })); }}><option value="number">自动编号</option><option value="skip">跳过</option></SelectControl></label>
                  </div>
                </section>
                <section className="export-section">
                  <h3>隐私与元数据</h3>
                  <label className="field"><span>元数据</span><SelectControl aria-label="元数据" value={exportSettings.metadata} onChange={(event) => { const metadata = event.currentTarget.value as ExportSettings["metadata"]; setExportSettings((value) => ({ ...value, metadata })); }}><option value="none">不保留</option><option value="basic">保留基础拍摄信息</option><option value="supported">尽可能保留受支持信息</option></SelectControl></label>
                  <label className={`check-field ${exportSettings.metadata === "none" ? "disabled" : ""}`}><input type="checkbox" checked={exportSettings.includeGps} disabled={exportSettings.metadata === "none"} onChange={(event) => { const includeGps = event.currentTarget.checked; setExportSettings((value) => ({ ...value, includeGps })); }} /><span><strong>保留 GPS 位置</strong><small>默认关闭，避免在分享照片时暴露拍摄地点</small></span></label>
                </section>
              </fieldset>
              <aside className="export-review" aria-label="导出摘要">
                <div><span>待导出</span><strong>{exportPlan.items.length} 张</strong></div>
                <div><span>文件名示例</span><code>{exportPlan.sampleFileName}</code></div>
                {exportPlan.sampleDimensions && <div><span>样例成品</span><strong>{exportPlan.sampleDimensions} px</strong></div>}
                {!!exportPlan.estimatedPixels && <small>预计处理 {(exportPlan.estimatedPixels / 1_000_000).toFixed(1)} 百万像素；实际耗时还受格式与磁盘速度影响。</small>}
                {!!visibleExportIssues.length && <div className="export-issues" role="alert"><strong><WarningCircle /> 请先处理</strong>{visibleExportIssues.map((issue, index) => <small key={`${issue.field}-${index}`}>{issue.message}</small>)}</div>}
                {!visibleExportIssues.length && <div className="export-ready"><Check /> 设置可用，开始前还会检查原图与输出目录。</div>}
              </aside>
            </div>
            <div className="export-dialog-footer"><span>原图不会被覆盖，设置会随上次工作自动恢复。</span><div>{!!visibleExportIssues.length && <button className="button secondary" type="button" disabled={exportChecking} onClick={() => { exportBody.current?.scrollTo({ top: 0 }); exportBody.current?.querySelector<HTMLButtonElement>(".directory-picker")?.focus({ preventScroll: true }); }}>返回修改设置</button>}<button className="button secondary" type="button" disabled={exportChecking} onClick={closeExport}>取消</button><button className="button primary" type="button" disabled={exportChecking || visibleExportIssues.length > 0} onClick={() => void startExport()}>{exportChecking ? "正在预检…" : isNative ? "预检并开始导出" : "保存设置"}</button></div></div>
          </section>
        </Modal>
      )}

      {exportRunning && exportProgress && (
        <Modal>
          <section className="progress-dialog" role="dialog" aria-modal="true" aria-labelledby="progress-title" aria-live="polite">
            <div className="progress-dialog-header"><span>批量导出</span><h2 id="progress-title">正在生成成品</h2></div>
            <div className="progress-body">
              <div className="progress-count"><strong>{exportProgress.current} / {exportProgress.total}</strong><span title={exportProgress.fileName}>{exportProgress.fileName}</span></div>
              <div className="progress-stage">{exportStageLabels[exportProgress.stage]} · <ExportElapsed startedAt={exportStartedAt} /></div>
              <progress aria-label="已处理照片" max={exportProgress.total || 1} value={exportProgress.completed} />
              <div className="progress-stats"><span>成功 {exportProgress.succeeded}</span><span>失败 {exportProgress.failed}</span><span>跳过 {exportProgress.skipped}</span></div>
              <p>按原图顺序逐张处理。取消会停止后续照片，已经完成的文件会保留。</p>
            </div>
            <div className="dialog-footer"><button className="button secondary" type="button" disabled={exportCancelling} onClick={() => void cancelExport()}>{exportCancelling ? "正在取消…" : "取消后续任务"}</button></div>
          </section>
        </Modal>
      )}

      {showCrop && activePhoto && <Suspense fallback={<Modal onClose={() => setShowCrop(false)}><section className="progress-dialog" role="dialog" aria-modal="true" aria-label="裁切照片"><p role="status">正在加载裁切工具…</p><button className="button secondary" type="button" onClick={() => setShowCrop(false)}>取消</button></section></Modal>}><CropEditor photo={activePhoto} onApply={applyCrop} onCancel={() => setShowCrop(false)} /></Suspense>}

      {!exportRunning && exportResult && (
        <Modal onClose={() => setExportResult(null)}>
          <section className="result-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title">
            <div className="result-dialog-header"><div><span>{exportResult.cancelled ? "任务已取消" : "批量导出"}</span><h2 id="result-title">{exportResult.cancelled ? "已停止后续导出" : exportResult.failed ? "导出完成，部分照片需要处理" : "导出完成"}</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={() => setExportResult(null)}><X /></button></div>
            <div className="result-body">
              <p className="export-elapsed">处理用时 {formatElapsed(exportResult.elapsedMs)}</p>
              {exportResult.cancelled && <p>未处理 {Math.max(0, exportResult.total - exportResult.succeeded - exportResult.failed - exportResult.skipped)} 张；已经完成的文件已保留。</p>}
              <div className="result-stats"><div><strong>{exportResult.succeeded}</strong><span>成功</span></div><div><strong>{exportResult.failed}</strong><span>失败</span></div><div><strong>{exportResult.skipped}</strong><span>跳过</span></div></div>
              {!!exportResult.failures.length && <details className="result-list" open><summary><WarningCircle /> 失败项目 · {exportResult.failures.length} 项</summary>{exportResult.failures.map((failure, index) => <div key={`${failure.path}-${index}`}><span title={failure.path || failure.fileName}>{failure.fileName}</span><small>{failure.reason}</small>{failure.path && <small className="result-source-path"><span>原图：</span><code>{failure.path}</code></small>}</div>)}</details>}
              {!!exportResult.warnings.length && <details className="result-list warning-list" open><summary><WarningCircle /> 导出提示 · {exportResult.warnings.length} 项</summary>{exportResult.warnings.map((warning) => <small key={warning}>{warning}</small>)}</details>}
            </div>
            <div className="dialog-footer">
              <button className="button secondary" type="button" onClick={() => setExportResult(null)}>关闭</button>
              {!!exportResult.failures.some((failure) => failure.path) && <button className="button secondary" type="button" onClick={() => { const paths = new Set(exportResult.failures.map((failure) => failure.path).filter(Boolean)); setExportResult(null); void startExport(paths); }}>重试失败项</button>}
              <button className="button primary" type="button" onClick={() => { void invoke("open_export_directory", { path: exportResult.outputDirectory }).catch((error) => setMessage(`无法打开输出文件夹：${String(error)}`)); }}><FolderSimple /> 打开输出文件夹</button>
            </div>
          </section>
        </Modal>
      )}
    </div>
  );
}

export default App;
