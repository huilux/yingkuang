import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { ArrowsIn, ArrowsOutSimple, Minus, Plus, X } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { NumericInput } from "./NumericInput";
import { previewMaximumZoom } from "./canvas-camera";
import { usePreviewFullscreen } from "./use-preview-fullscreen";
import type { EditorCanvasHandle } from "./EditorCanvas";
import type { EditorDocument, PhotoAsset } from "./types";

const EditorCanvas = lazy(() => import("./EditorCanvas").then(({ EditorCanvas }) => ({ default: EditorCanvas })));
const noSelection: string[] = [];
const ignoreEdit = () => {};

export function ResultPreview({ photo, document, onClose, onFullscreenChange, startFullscreen = false }: { photo: PhotoAsset; document: EditorDocument; onClose: () => void; onFullscreenChange: (value: boolean) => void; startFullscreen?: boolean }) {
  const titleId = useId();
  const helpId = useId();
  const canvas = useRef<EditorCanvasHandle>(null);
  const dialog = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(100);
  const screen = usePreviewFullscreen(dialog, onClose, onFullscreenChange, startFullscreen);
  const imageOnly = (screen.fullscreen || screen.starting) && !screen.error;
  useEffect(() => {
    const frame = requestAnimationFrame(() => canvas.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [imageOnly]);
  return <Modal className="result-preview-backdrop" onClose={() => { void screen.close(); }}>
    <section ref={dialog} className={`result-preview-dialog${imageOnly ? " is-fullscreen" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId}
      onKeyDownCapture={event => {
        const fullscreenKey = event.key === "F11" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (fullscreenKey || event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (event.repeat) return;
          if (event.key === "Escape" || imageOnly) void screen.close();
          else void screen.enter();
        }
      }}>
      <header className="result-preview-header" inert={imageOnly} aria-hidden={imageOnly}>
        <div className="result-preview-title"><h2 id={titleId}>成品预览</h2><span title={photo.fileName}>{photo.fileName}</span></div>
        <div className="result-preview-actions">
          <button className="icon-button" type="button" aria-label="缩小预览" disabled={zoom <= 10} onClick={() => canvas.current?.setZoom(zoom / 1.25)}><Minus aria-hidden="true" /></button>
          <label className="result-preview-zoom"><NumericInput label="预览缩放比例" value={Math.round(zoom)} min={10} max={previewMaximumZoom} onCommit={value => canvas.current?.setZoom(value)} /><span>%</span></label>
          <button className="icon-button" type="button" aria-label="放大预览" disabled={zoom >= previewMaximumZoom} onClick={() => canvas.current?.setZoom(zoom * 1.25)}><Plus aria-hidden="true" /></button>
          <button className="button secondary" type="button" onClick={() => canvas.current?.fit()}><ArrowsIn aria-hidden="true" />适应窗口</button>
          <button className="button secondary" type="button" aria-label="进入全屏预览" title="F11 全屏预览，Esc 返回编辑" disabled={screen.pending} onClick={() => { void screen.enter(); }}><ArrowsOutSimple aria-hidden="true" />全屏</button>
          <button className="button secondary" data-modal-initial type="button" aria-label="关闭成品预览" disabled={screen.pending} onClick={() => { void screen.close(); }}><X aria-hidden="true" />返回编辑</button>
        </div>
      </header>
      <Suspense fallback={<div className="canvas-viewport"><div className="canvas-loading" role="status"><span className="skeleton canvas-skeleton" /><strong>正在加载预览</strong></div></div>}>
        <EditorCanvas key={photo.id} ref={canvas} photo={photo} document={document} readOnly imageOnly={imageOnly} selectedLayerIds={noSelection} snapEnabled={false} onZoomChange={setZoom} onSelectionChange={ignoreEdit} onLayersCommit={ignoreEdit} />
      </Suspense>
      {screen.error && <div className="result-preview-error" role="alert">{screen.error}</div>}
      <footer id={helpId}>滚轮缩放 · 拖动或方向键平移 · F11 全屏预览 · Esc 返回编辑</footer>
    </section>
  </Modal>;
}
