import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowCounterClockwise, ArrowsClockwise, Minus, Plus, X } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { NumericInput } from "./NumericInput";
import { SelectControl } from "./SelectControl";
import { cropPixels, fitCropRatio, mapRotationCrop, moveCrop, normalizedCrop, normalizeRotation, resizeCrop, rotationDimensions, rotationFrameMapping, turnCrop, type CropHandle } from "./photo-crop";
import { useEditorPhoto } from "./use-editor-photo";
import { paintRotatedPhoto } from "./photo-transform";
import type { PhotoAsset, PhotoCrop, Rect } from "./types";

const handles: { id: CropHandle; x: number; y: number; label: string }[] = [
  { id: "nw", x: 0, y: 0, label: "左上" }, { id: "n", x: .5, y: 0, label: "上边" },
  { id: "ne", x: 1, y: 0, label: "右上" }, { id: "e", x: 1, y: .5, label: "右边" },
  { id: "se", x: 1, y: 1, label: "右下" }, { id: "s", x: .5, y: 1, label: "下边" },
  { id: "sw", x: 0, y: 1, label: "左下" }, { id: "w", x: 0, y: .5, label: "左边" },
];
type Camera = { x: number; y: number; scale: number };
type Gesture = { id: number; mode: "pan" | "move" | "draw" | CropHandle; x: number; y: number; rect: Rect; camera: Camera };

export default function CropEditor({ photo, onApply, onCancel }: {
  photo: PhotoAsset; onApply: (crop: PhotoCrop | undefined) => void; onCancel: () => void;
}) {
  const [rotation, setRotation] = useState(photo.crop?.rotation ?? 0);
  const [baseRotation, setBaseRotation] = useState(() => normalizeRotation(Math.round((photo.crop?.rotation ?? 0) / 90) * 90));
  const [bounds, setBounds] = useState(() => ({ x: 0, y: 0, ...rotationDimensions(photo.width, photo.height, photo.crop?.rotation) }));
  const mapping = rotationFrameMapping(bounds, rotationDimensions(photo.width, photo.height, rotation));
  const [rect, setRect] = useState(() => cropPixels(photo));
  const [grid, setGrid] = useState("auto");
  const [rotating, setRotating] = useState(false);
  const [preset, setPreset] = useState("free");
  const [flipped, setFlipped] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const bitmap = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const { image, loading, error } = useEditorPhoto(photo);
  const fitScale = Math.min((size.width - 64) / bounds.width, (size.height - 64) / bounds.height);
  const quarter = Math.round(baseRotation / 90);
  const fine = Math.round(normalizeRotation(rotation - baseRotation) * 10) / 10;
  const ratioValue = preset === "original" ? (Math.abs(quarter % 2) === 1 ? photo.height / photo.width : photo.width / photo.height) : preset === "free" ? undefined : Number(preset);
  const ratio = ratioValue ? (flipped ? 1 / ratioValue : ratioValue) : undefined;
  const gridCount = grid === "none" ? 0 : grid === "dense" || (grid === "auto" && rotating) ? 9 : 3;
  const outputRect = cropPixels({ ...photo, crop: normalizedCrop(mapRotationCrop(rect, mapping), photo, rotation) });
  const outputBounds = cropPixels({ ...photo, crop: normalizedCrop(mapRotationCrop(bounds, mapping), photo, rotation) });

  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const scale = Math.max(.00001, Math.min((size.width - 64) / bounds.width, (size.height - 64) / bounds.height));
    setCamera({ x: (size.width - bounds.width * scale) / 2, y: (size.height - bounds.height * scale) / 2, scale });
  }, [size, bounds.width, bounds.height]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(fit, [fit]);
  useLayoutEffect(() => {
    if (!image || !bitmap.current) return;
    paintRotatedPhoto(bitmap.current, image, photo.width, photo.height, rotation, 1800, bounds);
  }, [image, photo.width, photo.height, rotation, bounds]);
  useEffect(() => {
    const release = () => { space.current = false; };
    const keyup = (event: KeyboardEvent) => { if (event.code === "Space") release(); };
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("keyup", keyup); window.removeEventListener("blur", release); };
  }, []);

  function zoom(factor: number, anchor = { x: size.width / 2, y: size.height / 2 }) {
    if (gesture.current || fitScale <= 0) return;
    setCamera(current => {
      const scale = Math.max(fitScale * .5, Math.min(fitScale * 8, current.scale * factor));
      return { x: anchor.x - (anchor.x - current.x) * scale / current.scale,
        y: anchor.y - (anchor.y - current.y) * scale / current.scale, scale };
    });
  }
  function changePreset(value: string) {
    setPreset(value); setFlipped(false);
    const next = value === "original" ? ratioValueForOriginal() : value === "free" ? undefined : Number(value);
    if (next) setRect(current => fitCropRatio(current, next, bounds));
  }
  function ratioValueForOriginal() { return Math.abs(quarter % 2) === 1 ? photo.height / photo.width : photo.width / photo.height; }
  function changeRotation(value: number) {
    setRotation(normalizeRotation(value));
  }
  function rotateQuarter(clockwise: boolean) {
    setRotation(normalizeRotation(rotation + (clockwise ? 90 : -90)));
    setBaseRotation(normalizeRotation(baseRotation + (clockwise ? 90 : -90)));
    setRect(turnCrop(rect, bounds, clockwise));
    setBounds({ x: 0, y: 0, width: bounds.height, height: bounds.width });
    // Original ratio already swaps with the rotated photo dimensions.
    if (preset !== "free" && preset !== "original") setFlipped(value => !value);
  }
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const b = element.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * .002), { x: event.clientX - b.left, y: event.clientY - b.top });
      } else if (!gesture.current) setCamera(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [fitScale, size]);
  function changeField(key: keyof Rect, value: number) {
    const delta = (Math.round(value) - outputRect[key]) / mapping.scale;
    setRect(current => key === "x" || key === "y"
      ? moveCrop(current, key === "x" ? delta : 0, key === "y" ? delta : 0, bounds)
      : resizeCrop(current, key === "width" ? "e" : "s", key === "width" ? delta : 0,
        key === "height" ? delta : 0, bounds, ratio));
  }
  const apply = () => onApply(normalizedCrop(outputRect, photo, rotation));
  function reset() {
    setRotation(0); setBaseRotation(0);
    setBounds({ x: 0, y: 0, width: photo.width, height: photo.height });
    setRect({ x: 0, y: 0, width: photo.width, height: photo.height });
    setPreset("free"); setFlipped(false); fit();
  }
  const left = camera.x + rect.x * camera.scale, top = camera.y + rect.y * camera.scale;
  const width = rect.width * camera.scale, height = rect.height * camera.scale;
  return <Modal onClose={onCancel}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title" aria-describedby="crop-description"
      onKeyDown={event => { if (!event.defaultPrevented && event.key === "Enter" && !(event.target as HTMLElement).closest("button:not([data-crop-handle]), input, [role=combobox]")) { event.preventDefault(); if (!gesture.current) apply(); } }}>
      <header className="export-dialog-header"><div><h2 id="crop-title">裁切与旋转</h2><span title={photo.fileName}>{photo.fileName}</span></div><button className="icon-button" type="button" aria-label="取消裁切" onClick={onCancel}><X /></button></header>
      <div className="crop-body">
        <div className="crop-stage-column">
          <div className="crop-viewport" ref={viewport} tabIndex={0} data-modal-initial aria-label="照片裁切画布" aria-describedby="crop-help"
            onContextMenu={event => event.preventDefault()}
            onPointerDown={event => {
              if (gesture.current || (event.button !== 0 && event.button !== 1)) return;
              event.preventDefault(); event.currentTarget.focus();
              const target = event.target as HTMLElement;
              const handle = target.closest<HTMLElement>("[data-crop-handle]")?.dataset.cropHandle as CropHandle | undefined;
              const mode = event.button === 1 || space.current ? "pan" : handle ?? (target.closest("[data-crop-selection]") ? "move" : "draw");
              gesture.current = { id: event.pointerId, mode, x: event.clientX, y: event.clientY, rect, camera };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const g = gesture.current;
              if (!g || g.id !== event.pointerId) return;
              const dx = event.clientX - g.x, dy = event.clientY - g.y;
              if (g.mode === "pan") { setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy }); return; }
              if (g.mode === "move") setRect(moveCrop(g.rect, dx / g.camera.scale, dy / g.camera.scale, bounds));
              else if (g.mode === "draw") {
                const b = event.currentTarget.getBoundingClientRect();
                const px = (client: number, start: number, offset: number, limit: number) => Math.max(0, Math.min(limit, Math.round((client - start - offset) / g.camera.scale)));
                const x0 = px(g.x, b.left, g.camera.x, bounds.width - 1), y0 = px(g.y, b.top, g.camera.y, bounds.height - 1);
                const x1 = px(event.clientX, b.left, g.camera.x, bounds.width), y1 = px(event.clientY, b.top, g.camera.y, bounds.height);
                const next = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.max(1, Math.abs(x1 - x0)), height: Math.max(1, Math.abs(y1 - y0)) };
                setRect(ratio ? fitCropRatio(next, ratio, bounds) : next);
              } else setRect(resizeCrop(g.rect, g.mode, dx / g.camera.scale, dy / g.camera.scale, bounds, ratio));
            }}
            onPointerUp={event => { if (gesture.current?.id === event.pointerId) { gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
            onPointerCancel={() => { if (gesture.current) { setRect(gesture.current.rect); setCamera(gesture.current.camera); gesture.current = null; } }}
            onLostPointerCapture={() => { gesture.current = null; }}
            onKeyDown={event => {
              if (event.code === "Space") { event.preventDefault(); space.current = true; return; }
              if (gesture.current || event.ctrlKey || event.metaKey || event.altKey) return;
              const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const d = delta[event.key]; if (!d) return;
              event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1;
              const handle = (event.target as HTMLElement).dataset.cropHandle as CropHandle | undefined;
              setRect(current => handle ? resizeCrop(current, handle, d[0] * step, d[1] * step, bounds, ratio) : moveCrop(current, d[0] * step, d[1] * step, bounds));
            }}>
            <div className="crop-photo-surface" style={{ left: camera.x, top: camera.y, width: bounds.width * camera.scale, height: bounds.height * camera.scale }}>
              <canvas ref={bitmap} aria-hidden="true" />
              <svg viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-hidden="true">
                <path fill="rgba(0,0,0,.60)" fillRule="evenodd" d={`M0 0H${bounds.width}V${bounds.height}H0Z M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}Z`} />
              </svg>
            </div>
            <div className={`crop-selection ${rotating ? "is-rotating" : ""}`} data-crop-selection data-grid={gridCount} style={{ left, top, width, height }}>
              {Array.from({ length: Math.max(0, gridCount - 1) }, (_, i) => i + 1).map(n => <span key={`v${n}`} className="crop-grid-vertical" style={{ left: `${n / gridCount * 100}%` }} />)}
              {Array.from({ length: Math.max(0, gridCount - 1) }, (_, i) => i + 1).map(n => <span key={`h${n}`} className="crop-grid-horizontal" style={{ top: `${n / gridCount * 100}%` }} />)}
              {!!gridCount && <><span className="crop-center-vertical" /><span className="crop-center-horizontal" /></>}
              {rotating && <span className="crop-angle-badge" aria-hidden="true">{fine > 0 ? "+" : ""}{fine.toFixed(1)}°</span>}
            </div>
            {handles.map(h => <button key={h.id} className={`crop-handle crop-handle-${h.id}`} data-crop-handle={h.id} type="button" aria-label={`调整裁切${h.label}`} style={{ left: left + h.x * width, top: top + h.y * height }} />)}
            {(!image || error || loading) && <span className="crop-image-status" role="status">{!error && <i className="loading-spinner" aria-hidden="true" />}{error ? "高清照片读取失败，当前使用缩略图" : "正在加载照片…"}</span>}
          </div>
          <div className="crop-view-tools"><span id="crop-help">拖动选区或边角 · 方向键微调 · 空格拖动平移</span><div><button className="tool-button" type="button" aria-label="缩小裁切视图" onClick={() => zoom(1 / 1.25)}><Minus /></button><button className="tool-button" type="button" onClick={fit}>适应</button><button className="tool-button" type="button" aria-label="放大裁切视图" onClick={() => zoom(1.25)}><Plus /></button></div></div>
        </div>
        <aside className="crop-settings" aria-label="裁切设置">
          <p id="crop-description">先旋转或校正水平，再选取保留区域。相框和水印会重新适配，原文件保持完整。</p>
          <div className="crop-rotation-controls">
            <div className="crop-quarter-buttons"><button className="button secondary" type="button" aria-label="向左旋转90度" onClick={() => rotateQuarter(false)}><ArrowCounterClockwise /> 左转 90°</button><button className="button secondary" type="button" aria-label="向右旋转90度" onClick={() => rotateQuarter(true)}><ArrowClockwise /> 右转 90°</button></div>
            <div className="crop-straighten" onFocusCapture={() => setRotating(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRotating(false); }}>
            <div className="crop-angle-heading"><label htmlFor="straighten-angle">水平校正</label><button type="button" className="crop-angle-reset" disabled={!fine} onClick={() => changeRotation(baseRotation)}>归零</button></div>
            <div className="crop-angle-input"><NumericInput label="水平校正角度" value={fine} min={-45} max={45} step={.1} onPreview={value => changeRotation(baseRotation + Math.round(value * 10) / 10)} onCommit={value => changeRotation(baseRotation + Math.round(value * 10) / 10)} /><span>°</span></div>
            <input id="straighten-angle" type="range" aria-label="水平校正滑块" min={-45} max={45} step={.1} value={fine}
              onKeyDown={event => {
                if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); changeRotation(baseRotation + Math.max(-45, Math.min(45, fine + (event.key === "ArrowLeft" ? -1 : 1)))); }
              }}
              onChange={event => changeRotation(baseRotation + Number(event.currentTarget.value))} />
            <div className="crop-angle-scale" aria-hidden="true"><span>−45°</span><span>0°</span><span>+45°</span></div>
            </div>
            <label className="field"><span>参考线</span><SelectControl aria-label="旋转参考线" value={grid} onChange={event => setGrid(event.currentTarget.value)}><option value="auto">自动 · 旋转时加密</option><option value="thirds">三等分</option><option value="dense">密集网格</option><option value="none">隐藏</option></SelectControl></label>
          </div>
          <label className="field"><span>裁切比例</span><SelectControl aria-label="裁切比例" value={preset} onChange={event => changePreset(event.currentTarget.value)}><option value="free">自由比例</option><option value="original">原图比例</option><option value="1">1:1</option><option value="1.5">3:2</option><option value="1.3333333333333333">4:3</option><option value="1.7777777777777777">16:9</option></SelectControl></label>
          <button className="button secondary" type="button" disabled={!ratio || ratio === 1} onClick={() => { setFlipped(value => !value); if (ratio) setRect(current => fitCropRatio(current, 1 / ratio, bounds)); }}><ArrowsClockwise /> 切换横竖</button>
          <div className="crop-pixel-fields">{([{ key: "x", label: "左侧位置", min: outputBounds.x, max: outputBounds.x + outputBounds.width - outputRect.width }, { key: "y", label: "顶部位置", min: outputBounds.y, max: outputBounds.y + outputBounds.height - outputRect.height }, { key: "width", label: "选区宽度", min: 1, max: outputBounds.x + outputBounds.width - outputRect.x }, { key: "height", label: "选区高度", min: 1, max: outputBounds.y + outputBounds.height - outputRect.y }] as const).map(field => <label key={field.key}><span>{field.label} <small>px</small></span><NumericInput label={field.label} value={outputRect[field.key]} min={field.min} max={field.max} onCommit={value => changeField(field.key, value)} /></label>)}</div>
          <output className="crop-readout" aria-live="polite"><strong>{outputRect.width} × {outputRect.height} px</strong><span>保留 {(outputRect.width * outputRect.height / (photo.width * photo.height) * 100).toFixed(1)}% · {(outputRect.width * outputRect.height / 1_000_000).toFixed(2)} MP</span></output>
          <p className="crop-note">水平校正时选框固定，照片自动缩放以消除空白角。底部显示实际保留像素，90° 旋转保留选区。</p>
        </aside>
      </div>
      <footer className="export-dialog-footer"><div className="crop-footer-info"><strong>{outputRect.width} × {outputRect.height} px</strong><span>Enter 应用 · Esc 取消</span></div><div className="dialog-actions"><button className="tool-button crop-reset" type="button" onClick={reset}><ArrowCounterClockwise /> 重置为完整照片</button><button className="button secondary" type="button" onClick={onCancel}>取消</button><button className="button primary" type="button" onClick={apply}>应用调整</button></div></footer>
    </section>
  </Modal>;
}
