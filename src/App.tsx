import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  CaretDown,
  Check,
  DownloadSimple,
  FileImage,
  FolderOpen,
  FrameCorners,
  ImageSquare,
  Minus,
  Plus,
  SlidersHorizontal,
  SquaresFour,
  TextT,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import type { ExportSettings, FrameSettings, PhotoAsset } from "./types";
import "./App.css";

const isNative = "__TAURI_INTERNALS__" in window;
const sessionKey = "yingkuang-session-v1";

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
    capturedAt: "2026/08/22",
  },
};

const defaultFrame: FrameSettings = {
  type: "blur",
  color: "#f4f4f1",
  blur: 32,
  brightness: 75,
  paddingX: 34,
  paddingY: 28,
  radius: 10,
  shadow: 32,
};

const defaultExport: ExportSettings = {
  directory: "",
  format: "jpeg",
  quality: 92,
  size: "original",
  longEdge: 6000,
  metadata: "basic",
  includeGps: false,
};

type LoadState = "idle" | "loading" | "error";
type InspectorTab = "frame" | "watermark";

function SliderRow({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field slider-field">
      <span className="field-heading">
        <span>{label}</span>
        <output>{value}{suffix}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
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
          <button
            className={value === option.value ? "selected" : ""}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
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

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoAsset[]>(isNative ? [] : [demoPhoto]);
  const [activeId, setActiveId] = useState(isNative ? "" : demoPhoto.id);
  const [checkedIds, setCheckedIds] = useState<string[]>(isNative ? [] : [demoPhoto.id]);
  const [frame, setFrame] = useState(defaultFrame);
  const [zoom, setZoom] = useState(68);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("frame");
  const [activeTemplate, setActiveTemplate] = useState("blur-bottom");
  const [showExport, setShowExport] = useState(false);
  const [exportSettings, setExportSettings] = useState(defaultExport);
  const [sessionReady, setSessionReady] = useState(!isNative);

  const activePhoto = photos.find((photo) => photo.id === activeId) ?? photos[0];
  const selectedCount = checkedIds.length;

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    async function restoreSession() {
      setLoadState("loading");
      try {
        const saved = JSON.parse(localStorage.getItem(sessionKey) ?? "{}") as {
          paths?: string[];
          activePath?: string;
          checkedPaths?: string[];
          frame?: FrameSettings;
          exportSettings?: ExportSettings;
        };
        if (saved.frame) setFrame(saved.frame);
        if (saved.exportSettings) setExportSettings(saved.exportSettings);
        if (saved.paths?.length) {
          const restored = await invoke<PhotoAsset[]>("inspect_images", { paths: saved.paths });
          if (cancelled) return;
          setPhotos(restored);
          const active = restored.find((photo) => photo.path === saved.activePath) ?? restored[0];
          setActiveId(active?.id ?? "");
          const checkedPaths = new Set(saved.checkedPaths ?? []);
          setCheckedIds(restored.filter((photo) => checkedPaths.has(photo.path)).map((photo) => photo.id));
          setMessage(restored.length ? `已恢复上次的 ${restored.length} 张照片` : "");
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
    if (!isNative || !sessionReady) return;
    const checked = new Set(checkedIds);
    localStorage.setItem(sessionKey, JSON.stringify({
      paths: photos.map((photo) => photo.path).filter(Boolean),
      activePath: activePhoto?.path ?? "",
      checkedPaths: photos.filter((photo) => checked.has(photo.id)).map((photo) => photo.path),
      frame,
      exportSettings,
    }));
  }, [activePhoto?.path, checkedIds, exportSettings, frame, photos, sessionReady]);

  const photoStyle = useMemo(() => ({
    "--frame-color": frame.color,
    "--frame-blur": `${frame.blur}px`,
    "--frame-brightness": `${frame.brightness}%`,
    "--frame-pad-x": `${frame.paddingX}px`,
    "--frame-pad-y": `${frame.paddingY}px`,
    "--photo-radius": `${frame.radius}px`,
    "--photo-shadow": `0 ${Math.round(frame.shadow * 0.28)}px ${Math.round(frame.shadow * 1.15)}px rgb(7 9 9 / ${Math.min(0.44, frame.shadow / 110)})`,
    "--preview-zoom": `${zoom / 100}`,
  }) as CSSProperties, [frame, zoom]);

  function updateFrame<K extends keyof FrameSettings>(key: K, value: FrameSettings[K]) {
    setFrame((current) => ({ ...current, [key]: value }));
  }

  function addPhotos(next: PhotoAsset[]) {
    if (!next.length) return;
    setPhotos((current) => {
      const known = new Set(current.map((photo) => photo.path || photo.id));
      return [...current, ...next.filter((photo) => !known.has(photo.path || photo.id))];
    });
    setActiveId(next[0].id);
    setCheckedIds((current) => [...new Set([...current, ...next.map((photo) => photo.id)])]);
  }

  async function importNativePhotos() {
    setMessage("");
    const selection = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "摄影图片", extensions: ["jpg", "jpeg", "png"] }],
    });
    const paths = selection ? (Array.isArray(selection) ? selection : [selection]) : [];
    if (!paths.length) return;
    setLoadState("loading");
    try {
      const imported = await invoke<PhotoAsset[]>("inspect_images", { paths });
      addPhotos(imported);
      setLoadState("idle");
      setMessage(`已导入 ${imported.length} 张照片`);
    } catch (error) {
      setLoadState("error");
      setMessage(String(error));
    }
  }

  async function importBrowserPhotos(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    setLoadState("loading");
    try {
      const imported = await Promise.all(files.map(async (file, index): Promise<PhotoAsset> => {
        const bitmap = await createImageBitmap(file);
        const result: PhotoAsset = {
          id: `browser-${file.name}-${file.lastModified}-${index}`,
          path: file.name,
          fileName: file.name,
          width: bitmap.width,
          height: bitmap.height,
          megapixels: (bitmap.width * bitmap.height) / 1_000_000,
          thumbnailDataUrl: URL.createObjectURL(file),
          metadata: {},
        };
        bitmap.close();
        return result;
      }));
      addPhotos(imported);
      setLoadState("idle");
      setMessage(`已导入 ${imported.length} 张照片，浏览器预览不读取 EXIF`);
    } catch (error) {
      setLoadState("error");
      setMessage(`读取图片失败：${String(error)}`);
    } finally {
      input.value = "";
    }
  }

  function handleImport() {
    if (isNative) void importNativePhotos();
    else fileInput.current?.click();
  }

  function toggleChecked(id: string) {
    setCheckedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  function applyTemplate(id: string) {
    setActiveTemplate(id);
    if (id === "solid-white") {
      setFrame({ ...defaultFrame, type: "solid", color: "#f4f4f1", radius: 0, shadow: 0 });
    } else if (id === "wide-float") {
      setFrame({ ...defaultFrame, paddingX: 58, paddingY: 46, radius: 16, shadow: 45 });
    } else {
      setFrame(defaultFrame);
    }
  }

  async function selectOutputDirectory() {
    if (!isNative) {
      setExportSettings((current) => ({ ...current, directory: "浏览器下载目录" }));
      return;
    }
    const path = await open({ directory: true, multiple: false, title: "选择导出文件夹" });
    if (typeof path === "string") {
      setExportSettings((current) => ({ ...current, directory: path }));
    }
  }

  const watermarkValues = activePhoto
    ? [
        activePhoto.metadata.focalLength,
        activePhoto.metadata.aperture,
        activePhoto.metadata.shutter,
        activePhoto.metadata.iso,
      ].filter(Boolean)
    : [];

  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={(event) => void importBrowserPhotos(event)}
      />

      <header className="app-header">
        <div className="brand-block" aria-label="映框">
          <span className="brand-mark"><FrameCorners weight="bold" /></span>
          <div>
            <strong>映框</strong>
            <span>摄影水印与相框</span>
          </div>
        </div>
        <div className="project-title">
          <span>当前批次</span>
          <strong>{photos.length ? `${photos.length} 张照片` : "未导入照片"}</strong>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" aria-label="撤销" disabled><ArrowCounterClockwise /></button>
          <button className="icon-button" type="button" aria-label="重做" disabled><ArrowClockwise /></button>
          <span className="header-divider" />
          <button className="button secondary" type="button" onClick={handleImport}>
            <UploadSimple /> 导入照片
          </button>
          <button className="button primary" type="button" onClick={() => setShowExport(true)} disabled={!photos.length}>
            <DownloadSimple /> 导出
          </button>
        </div>
      </header>

      <main className="workbench">
        <aside className="library-panel">
          <div className="panel-heading">
            <div>
              <span>模板</span>
              <strong>相框样式</strong>
            </div>
            <button className="icon-button quiet" type="button" aria-label="模板菜单"><SquaresFour /></button>
          </div>
          <div className="template-list">
            <button className={`template-card ${activeTemplate === "blur-bottom" ? "active" : ""}`} type="button" onClick={() => applyTemplate("blur-bottom")}>
              <span className="template-preview blur-template"><img src="/demo.jpg" alt="模糊底部信息栏模板" /></span>
              <span><strong>底部信息栏</strong><small>模糊背景，三行水印</small></span>
              {activeTemplate === "blur-bottom" && <Check weight="bold" />}
            </button>
            <button className={`template-card ${activeTemplate === "wide-float" ? "active" : ""}`} type="button" onClick={() => applyTemplate("wide-float")}>
              <span className="template-preview wide-template"><img src="/demo.jpg" alt="宽边悬浮模板" /></span>
              <span><strong>宽边悬浮</strong><small>宽留白，柔和阴影</small></span>
              {activeTemplate === "wide-float" && <Check weight="bold" />}
            </button>
            <button className={`template-card ${activeTemplate === "solid-white" ? "active" : ""}`} type="button" onClick={() => applyTemplate("solid-white")}>
              <span className="template-preview solid-template"><img src="/demo.jpg" alt="纯白相框模板" /></span>
              <span><strong>纯白相框</strong><small>白色背景，深色文字</small></span>
              {activeTemplate === "solid-white" && <Check weight="bold" />}
            </button>
          </div>

          <div className="library-section-title">
            <span>照片</span>
            <small>{photos.length}</small>
          </div>
          <div className="photo-list">
            {!photos.length ? (
              <button className="library-empty" type="button" onClick={handleImport}>
                <ImageSquare />
                <span>导入 JPEG 或 PNG</span>
              </button>
            ) : photos.map((photo) => (
              <button
                type="button"
                key={photo.id}
                className={`photo-row ${photo.id === activePhoto?.id ? "active" : ""}`}
                onClick={() => setActiveId(photo.id)}
              >
                <span className="check-control" role="checkbox" aria-checked={checkedIds.includes(photo.id)} onClick={(event) => { event.stopPropagation(); toggleChecked(photo.id); }}>
                  {checkedIds.includes(photo.id) && <Check weight="bold" />}
                </span>
                <img src={photo.thumbnailDataUrl} alt="" />
                <span className="photo-row-copy">
                  <strong>{photo.fileName}</strong>
                  <small>{formatPixels(photo)}</small>
                </span>
              </button>
            ))}
          </div>
          <button className="add-photo-button" type="button" onClick={handleImport}><Plus /> 添加照片</button>
        </aside>

        <section className="editor-panel">
          <div className="canvas-toolbar">
            <div className="toolbar-group">
              <button className="tool-button selected" type="button"><SlidersHorizontal /> 编辑</button>
              <button className="tool-button" type="button"><TextT /> 文字</button>
            </div>
            <div className="zoom-control">
              <button type="button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(20, value - 10))}><Minus /></button>
              <input aria-label="画布缩放" type="range" min="20" max="160" value={zoom} onChange={(event) => setZoom(Number(event.currentTarget.value))} />
              <output>{zoom}%</output>
              <button type="button" aria-label="放大" onClick={() => setZoom((value) => Math.min(160, value + 10))}><Plus /></button>
              <button className="fit-button" type="button" onClick={() => setZoom(68)}>适应</button>
            </div>
          </div>

          <div className="canvas-viewport">
            {loadState === "loading" ? (
              <div className="canvas-loading" aria-live="polite">
                <span className="skeleton canvas-skeleton" />
                <strong>正在读取照片</strong>
                <span>生成缩略图并读取拍摄信息</span>
              </div>
            ) : activePhoto ? (
              <div className="preview-scale" style={photoStyle}>
                <div className={`frame-surface ${frame.type}`}>
                  {frame.type === "blur" && <img className="frame-backdrop" src={activePhoto.thumbnailDataUrl} alt="" />}
                  <div className="photo-wrap">
                    <img className="main-photo" src={activePhoto.thumbnailDataUrl} alt={activePhoto.fileName} />
                  </div>
                  <div className="watermark-layout">
                    <div className="watermark-brand">
                      <strong>LUMIX</strong>
                      <span>{activePhoto.metadata.camera ?? "相机型号"}</span>
                    </div>
                    <div className="watermark-values">
                      {watermarkValues.length ? watermarkValues.map((value) => <span key={value}>{value}</span>) : <span>未读取到拍摄参数</span>}
                    </div>
                    <span className="watermark-date">{activePhoto.metadata.capturedAt?.replace(/:/g, "/") ?? "拍摄日期"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="canvas-empty">
                <span className="empty-icon"><FileImage /></span>
                <strong>从一张照片开始</strong>
                <p>导入 JPEG 或 PNG，在本机读取参数并实时设计相框。</p>
                <button className="button primary" type="button" onClick={handleImport}><UploadSimple /> 导入照片</button>
              </div>
            )}
          </div>

          <div className={`status-bar ${loadState === "error" ? "error" : ""}`}>
            <span>{message || (activePhoto ? `${activePhoto.fileName}  ${activePhoto.megapixels.toFixed(1)} MP` : "准备就绪")}</span>
            <span>{activePhoto ? `${formatPixels(activePhoto)}  sRGB  预览` : "完全本地处理"}</span>
          </div>

          <div className="filmstrip">
            <div className="filmstrip-heading">
              <span>{photos.length} 张照片</span>
              <span>已选 {selectedCount} 张</span>
            </div>
            <div className="filmstrip-track">
              {photos.map((photo) => (
                <button type="button" key={photo.id} className={`film-photo ${photo.id === activePhoto?.id ? "active" : ""}`} onClick={() => setActiveId(photo.id)}>
                  <img src={photo.thumbnailDataUrl} alt={photo.fileName} />
                  <span>{photo.fileName}</span>
                </button>
              ))}
              {!!photos.length && <button className="film-add" type="button" onClick={handleImport}><Plus /><span>添加</span></button>}
            </div>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">
            <button type="button" className={inspectorTab === "frame" ? "active" : ""} onClick={() => setInspectorTab("frame")}><FrameCorners /> 相框</button>
            <button type="button" className={inspectorTab === "watermark" ? "active" : ""} onClick={() => setInspectorTab("watermark")}><TextT /> 水印</button>
          </div>

          {inspectorTab === "frame" ? (
            <div className="inspector-scroll">
              <section className="inspector-section">
                <div className="section-heading"><strong>相框外观</strong><span>实时预览</span></div>
                <Segmented
                  label="相框类型"
                  value={frame.type}
                  options={[{ value: "blur", label: "照片模糊" }, { value: "solid", label: "纯色" }]}
                  onChange={(value) => updateFrame("type", value)}
                />
                {frame.type === "blur" ? (
                  <>
                    <SliderRow label="模糊程度" value={frame.blur} min={0} max={70} onChange={(value) => updateFrame("blur", value)} />
                    <SliderRow label="背景亮度" value={frame.brightness} min={30} max={130} suffix="%" onChange={(value) => updateFrame("brightness", value)} />
                  </>
                ) : (
                  <label className="field color-field">
                    <span>相框颜色</span>
                    <span className="color-input-wrap"><input type="color" value={frame.color} onChange={(event) => updateFrame("color", event.currentTarget.value)} /><code>{frame.color.toUpperCase()}</code></span>
                  </label>
                )}
              </section>

              <section className="inspector-section">
                <div className="section-heading"><strong>照片与留白</strong></div>
                <SliderRow label="左右基础留白" value={frame.paddingX} min={0} max={80} suffix="" onChange={(value) => updateFrame("paddingX", value)} />
                <SliderRow label="上下基础留白" value={frame.paddingY} min={0} max={80} suffix="" onChange={(value) => updateFrame("paddingY", value)} />
                <SliderRow label="照片圆角" value={frame.radius} min={0} max={32} onChange={(value) => updateFrame("radius", value)} />
                <SliderRow label="照片阴影" value={frame.shadow} min={0} max={64} onChange={(value) => updateFrame("shadow", value)} />
              </section>

              <section className="inspector-section">
                <div className="section-heading"><strong>参数区域</strong><button type="button">高级设置 <CaretDown /></button></div>
                <p className="section-help">选择参数可以出现的位置。关闭区域会保留其中的内容。</p>
                <div className="region-grid">
                  <button type="button"><span>上</span><small>关闭</small></button>
                  <button type="button" className="enabled"><span>下</span><small>13%</small></button>
                  <button type="button"><span>左</span><small>关闭</small></button>
                  <button type="button"><span>右</span><small>关闭</small></button>
                </div>
              </section>
            </div>
          ) : (
            <div className="inspector-scroll">
              <section className="inspector-section">
                <div className="section-heading"><strong>水印图层</strong><button type="button"><Plus /> 添加参数</button></div>
                <div className="layer-list">
                  {[
                    ["品牌文字", "LUMIX"],
                    ["相机型号", activePhoto?.metadata.camera ?? "未读取"],
                    ["焦距", activePhoto?.metadata.focalLength ?? "未读取"],
                    ["光圈", activePhoto?.metadata.aperture ?? "未读取"],
                    ["快门", activePhoto?.metadata.shutter ?? "未读取"],
                    ["ISO", activePhoto?.metadata.iso ?? "未读取"],
                  ].map(([label, value]) => (
                    <button type="button" className="layer-row" key={label}><TextT /><span><strong>{label}</strong><small>{value}</small></span><Check /></button>
                  ))}
                </div>
              </section>
              <section className="inspector-section muted-section">
                <strong>选择画布中的文字</strong>
                <p>选择后可以修改字体、字号、颜色、所属区域和精确位置。</p>
              </section>
            </div>
          )}
        </aside>
      </main>

      {showExport && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowExport(false); }}>
          <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <header>
              <div><span>批量导出</span><h2 id="export-title">导出 {selectedCount || photos.length} 张照片</h2></div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowExport(false)}><X /></button>
            </header>
            <div className="export-body">
              <label className="field">
                <span>输出文件夹</span>
                <button className="directory-picker" type="button" onClick={() => void selectOutputDirectory()}>
                  <FolderOpen /><span>{exportSettings.directory || "选择本地文件夹"}</span><CaretDown />
                </button>
              </label>
              <div className="export-grid">
                <label className="field"><span>格式</span><select value={exportSettings.format} onChange={(event) => setExportSettings((value) => ({ ...value, format: event.currentTarget.value as "jpeg" | "png" }))}><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label>
                <label className="field"><span>成品尺寸</span><select value={exportSettings.size} onChange={(event) => setExportSettings((value) => ({ ...value, size: event.currentTarget.value as "original" | "long-edge" }))}><option value="original">保持主照片像素</option><option value="long-edge">指定成品长边</option></select></label>
              </div>
              {exportSettings.format === "jpeg" && <SliderRow label="JPEG 质量" value={exportSettings.quality} min={1} max={100} onChange={(quality) => setExportSettings((value) => ({ ...value, quality }))} />}
              <label className="field"><span>元数据</span><select value={exportSettings.metadata} onChange={(event) => setExportSettings((value) => ({ ...value, metadata: event.currentTarget.value as ExportSettings["metadata"] }))}><option value="none">不保留</option><option value="basic">保留基础拍摄信息</option><option value="supported">尽可能保留受支持信息</option></select></label>
              <label className={`check-field ${exportSettings.metadata === "none" ? "disabled" : ""}`}><input type="checkbox" checked={exportSettings.includeGps} disabled={exportSettings.metadata === "none"} onChange={(event) => setExportSettings((value) => ({ ...value, includeGps: event.currentTarget.checked }))} /><span><strong>保留 GPS 位置</strong><small>默认关闭，单独控制照片中的定位信息</small></span></label>
              <div className="export-summary"><span>文件名示例</span><strong>{activePhoto?.fileName.replace(/\.[^.]+$/, "") ?? "照片"}-相框.{exportSettings.format === "jpeg" ? "jpg" : "png"}</strong></div>
            </div>
            <footer>
              <span>原图不会被覆盖，重名文件自动编号。</span>
              <div>
                <button className="button secondary" type="button" onClick={() => setShowExport(false)}>取消</button>
                <button
                  className="button primary"
                  type="button"
                  disabled={!exportSettings.directory}
                  onClick={() => {
                    setShowExport(false);
                    setMessage("导出设置已保存");
                  }}
                >
                  保存设置
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
