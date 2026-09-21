import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { FileImage, Magnet, Minus, Plus, SlidersHorizontal, UploadSimple } from "@phosphor-icons/react";
import { EditorCanvas } from "./EditorCanvas";
import { calculateGeometry } from "./editor-model";
import type { EditorDocument, PhotoAsset } from "./types";

type Props = Omit<ComponentProps<typeof EditorCanvas>, "photo" | "document" | "zoom" | "onZoomChange" | "viewportRef"> & {
  photo?: PhotoAsset;
  document?: EditorDocument;
  loading: boolean;
  onImport: () => void;
  onToggleSnap: () => void;
};

// View-only zoom belongs here: wheel frames do not rerender the photo library,
// templates or inspector, and do not touch document history/persistence.
export function EditorWorkspace({ photo, document, loading, onImport, onToggleSnap, ...canvasProps }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(68);
  const { snapEnabled } = canvasProps;
  function fitCanvas() {
    if (!photo || !document || !viewportRef.current) return;
    const geometry = calculateGeometry(photo, document);
    const width = Math.max(420, Math.min(860, geometry.width * 0.48));
    const height = width * geometry.height / geometry.width;
    const availableWidth = Math.max(1, viewportRef.current.clientWidth - 80);
    const availableHeight = Math.max(1, viewportRef.current.clientHeight - 80);
    setZoom(Math.max(20, Math.min(300, Math.floor(Math.min(availableWidth / width, availableHeight / height) * 100))));
  }
  useLayoutEffect(() => { fitCanvas(); }, [photo?.id]);
  return <>
    <div className="canvas-toolbar">
      <div className="toolbar-group"><button className="tool-button selected" type="button"><SlidersHorizontal /> 编辑</button><button className={`tool-button ${snapEnabled ? "selected" : ""}`} type="button" aria-pressed={snapEnabled} onClick={onToggleSnap}><Magnet /> 吸附</button></div>
      <div className="zoom-control">
        <button type="button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(20, value - 10))}><Minus /></button><input aria-label="画布缩放" type="range" min="20" max="300" step="any" value={zoom} onChange={(event) => setZoom(Number(event.currentTarget.value))} /><output>{Math.round(zoom)}%</output><button type="button" aria-label="放大" onClick={() => setZoom((value) => Math.min(300, value + 10))}><Plus /></button><button className="fit-button" type="button" onClick={fitCanvas}>适应</button>
      </div>
    </div>

    {loading && !photo ? (
      <div className="canvas-viewport" ref={viewportRef}><div className="canvas-loading" aria-live="polite"><span className="skeleton canvas-skeleton" /><strong>正在读取照片</strong><span>生成缩略图并读取拍摄信息</span></div></div>
    ) : photo && document ? (
      <EditorCanvas key={photo.id} {...canvasProps} photo={photo} document={document} zoom={zoom} onZoomChange={setZoom} viewportRef={viewportRef} />
    ) : (
      <div className="canvas-viewport" ref={viewportRef}><div className="canvas-empty"><span className="empty-icon"><FileImage /></span><strong>从一张照片开始</strong><p>导入 JPEG 或 PNG，在本机读取参数并实时设计相框。</p><button className="button primary" type="button" onClick={onImport}><UploadSimple /> 导入照片</button></div></div>
    )}
  </>;
}
