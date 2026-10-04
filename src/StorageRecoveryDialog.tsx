import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Modal } from "./Modal";

export type StorageRecovery = {
  scope: "session" | "templates";
  key: string;
  label: string;
  description: string;
  originalRecords: Record<string, string | null>;
  currentContent: string;
};

export function StorageRecoveryDialog({ recovery, onClose, onRecovered }: {
  recovery: StorageRecovery;
  onClose: () => void;
  onRecovered: (recovery: StorageRecovery) => void;
}) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [backupPath, setBackupPath] = useState("");
  const [error, setError] = useState("");

  async function backup() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const path = await save({ defaultPath: `映框-${recovery.label}-恢复备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "恢复备份", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      const content = JSON.stringify({ format: "yingkuang-storage-recovery", version: 1, createdAt: new Date().toISOString(),
        originalRecords: recovery.originalRecords, currentRecords: { [recovery.key]: recovery.currentContent } }, null, 2);
      await invoke("write_template_backup", { path, content });
      setBackupPath(path);
    } catch (cause) { setError(`备份失败，原记录未改变：${String(cause)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function recover() {
    if (!backupPath || busyRef.current) return;
    setError("");
    try {
      for (const [key, original] of Object.entries(recovery.originalRecords)) {
        if (localStorage.getItem(key) !== original) throw new Error("原记录已改变，请关闭此窗口后重新备份");
      }
      // setItem replaces a single record atomically; a quota error keeps its old value.
      localStorage.setItem(recovery.key, recovery.currentContent);
      onRecovered(recovery);
    } catch (cause) { setError(`尚未恢复自动保存：${String(cause)}。备份文件已保留。`); }
  }

  return <Modal onClose={busy ? undefined : onClose}>
    <section className="compact-dialog storage-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-recovery-title" aria-busy={busy}>
      <div className="compact-dialog-header"><div><span>存储恢复</span><h2 id="storage-recovery-title">备份并恢复{recovery.label}</h2></div></div>
      <div className="compact-dialog-body">
        <p>先把原始记录和当前内容备份到文件，再启用自动保存。</p>
        <p>{recovery.description}</p>
        <p>恢复后将保存当前可见内容；无法读取的部分保留在备份中，需要另行修复。</p>
        {backupPath && <p className="recovery-backup-path" role="status">备份已保存：{backupPath}</p>}
        {error && <p className="field-message" role="alert">{error}</p>}
      </div>
      <footer><button className="button secondary" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button secondary" type="button" disabled={busy} onClick={() => void backup()}>{busy ? "正在备份…" : backupPath ? "另存备份" : "备份原始记录"}</button><button className="button primary" type="button" disabled={busy || !backupPath} onClick={recover}>恢复自动保存</button></footer>
    </section>
  </Modal>;
}
