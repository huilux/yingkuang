import { FrameCorners, X } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import type { PhotoAsset } from "./types";

/** Keep the editor's dimensions and focus boundary while its first chunk loads. */
export function CropLoading({ photo, onCancel }: { photo: PhotoAsset; onCancel: () => void }) {
  return <Modal onClose={onCancel}>
    <section className="crop-dialog crop-loading" role="dialog" aria-modal="true" aria-labelledby="crop-loading-title">
      <header className="export-dialog-header"><div><h2 id="crop-loading-title">裁切与旋转</h2><span title={photo.fileName}>{photo.fileName}</span></div><button className="icon-button" type="button" aria-label="取消裁切" onClick={onCancel}><X /></button></header>
      <div className="crop-body" aria-busy="true">
        <div className="crop-loading-preview">
          <img src={photo.thumbnailDataUrl} alt="" />
          <div className="crop-loading-feedback" role="status">
            <FrameCorners className="crop-loading-symbol" aria-hidden="true" weight="light" />
            <strong>正在准备裁切工具</strong>
            <span><i className="loading-spinner" aria-hidden="true" />即将就绪，请稍候…</span>
          </div>
        </div>
        <aside className="crop-settings crop-loading-settings" aria-hidden="true">
          <div /><div /><div /><div />
        </aside>
      </div>
      <footer className="export-dialog-footer"><span>原文件保持完整</span><button className="button secondary" type="button" data-modal-initial onClick={onCancel}>取消</button></footer>
    </section>
  </Modal>;
}
