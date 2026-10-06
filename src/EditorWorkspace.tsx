import { lazy, Suspense, useState, type RefObject } from "react";
import { FileImage, Magnet, Minus, Plus, UploadSimple } from "@phosphor-icons/react";
import type { EditorCanvasHandle, EditorCanvasProps } from "./EditorCanvas";
import { NumericInput } from "./NumericInput";
import type { EditorDocument, PhotoAsset } from "./types";

const EditorCanvas = lazy(() => import("./EditorCanvas").then(({ EditorCanvas }) => ({ default: EditorCanvas })));

type Props = Omit<EditorCanvasProps, "photo" | "document" | "onZoomChange"> & {
  photo?: PhotoAsset;
  document?: EditorDocument;
  editorRef: RefObject<EditorCanvasHandle | null>;
  loading: boolean;
  onImport: () => void;
  onToggleSnap: () => void;
};

export function EditorWorkspace({ photo, document, loading, onImport, onToggleSnap, editorRef: canvasRef, ...canvasProps }: Props) {
  const [zoom, setZoom] = useState(68);
  const { snapEnabled } = canvasProps;
  return <>
    <div className="canvas-toolbar">
      <div className="toolbar-group"><button className={`tool-button ${snapEnabled ? "selected" : ""}`} type="button" aria-pressed={snapEnabled} title="拖动水印时对齐区域边缘与中心线" onClick={onToggleSnap}><Magnet /> 吸附</button><span className="canvas-interaction-hint">空格 + 拖动平移</span></div>
      <div className="zoom-control">
        <button type="button" aria-label="缩小" onClick={() => canvasRef.current?.setZoom(zoom - 10)}><Minus /></button><input aria-label="画布缩放" type="range" min="10" max="300" step="any" value={zoom} onChange={event => { const value = Number(event.currentTarget.value); setZoom(value); canvasRef.current?.setZoom(value); }} /><label className="zoom-number"><NumericInput label="缩放比例" value={Math.round(zoom)} min={10} max={300} onCommit={value => { setZoom(value); canvasRef.current?.setZoom(value); }} /><span>%</span></label><button type="button" aria-label="放大" onClick={() => canvasRef.current?.setZoom(zoom + 10)}><Plus /></button><button className="fit-button" type="button" onClick={() => canvasRef.current?.fit()}>适应</button>
      </div>
    </div>
    {loading && !photo ? (
      <div className="canvas-viewport"><div className="canvas-loading" aria-live="polite"><span className="skeleton canvas-skeleton" /><strong>正在读取照片</strong><span>生成缩略图并读取拍摄信息</span></div></div>
    ) : photo && document ? (
      <Suspense fallback={<div className="canvas-viewport"><div className="canvas-loading" aria-live="polite"><span className="skeleton canvas-skeleton" /><strong>正在加载编辑器</strong></div></div>}>
        <EditorCanvas key={photo.id} ref={canvasRef} {...canvasProps} photo={photo} document={document} onZoomChange={setZoom} />
      </Suspense>
    ) : (
      <div className="canvas-viewport"><div className="canvas-empty"><span className="empty-icon"><FileImage /></span><strong>从一张照片开始</strong><p>导入 JPEG 或 PNG，在本机读取参数并实时设计相框。</p><button className="button primary" type="button" onClick={onImport}><UploadSimple /> 导入照片</button></div></div>
    )}
  </>;
}
