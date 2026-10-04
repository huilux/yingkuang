import { useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Check, Copy, DownloadSimple, FloppyDisk, PencilSimple, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { TemplatePreview } from "./TemplatePreview";
import { builtInTemplateChanges, serializeBuiltInCatalog } from "./builtin-template-catalog";
import { maxTemplateNameLength, templateNameError, findTemplateConflict, parseTemplateBackup, serializeTemplateBackup, type ImportChoice, type ImportDecision, type TemplateBackup } from "./template-library";
import type { TemplateChange } from "./template-diff";
import type { PhotoAsset, TemplateRecord } from "./types";

type Props = {
  templates: TemplateRecord[];
  defaultTemplateId: string;
  photo?: PhotoAsset;
  onClose: () => void;
  onDefaultChange: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  onImport: (decisions: ImportDecision[], backupDefaultId: string, restoreDefault: boolean) => void;
};

const isNative = "__TAURI_INTERNALS__" in window;

function TemplateChanges({ changes }: { changes: TemplateChange[] }) {
  const groups = [...new Set(changes.map((change) => change.group))];
  return <details className="template-diff">
    <summary>查看与项目内置模板的 {changes.length} 项差异</summary>
    <div className="template-diff-content">
      {groups.map((group) => <section key={group}>
        <h3>{group}</h3>
        <dl>{changes.filter((change) => change.group === group).map((change, index) => <div key={`${change.field}-${index}`} className="template-diff-field">
          <dt>{change.field}</dt>
          <dd><span><small>项目内置</small><code title={change.builtInValue}>{change.builtInValue}</code></span><span aria-hidden="true">→</span><span><small>本机当前</small><code title={change.localValue}>{change.localValue}</code></span></dd>
        </div>)}</dl>
      </section>)}
    </div>
  </details>;
}

export function TemplateManager({ templates, defaultTemplateId, photo, onClose, onDefaultChange, onRename, onDuplicate, onDelete, onReset, onImport }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<TemplateBackup | null>(null);
  const [choices, setChoices] = useState<Record<number, ImportChoice | "">>({});
  const [restoreDefault, setRestoreDefault] = useState(true);
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [pendingAction, setPendingAction] = useState<{ id: string; type: "delete" | "reset" } | null>(null);
  const [error, setError] = useState("");

  function receiveBackup(source: string) {
    try {
      const parsed = parseTemplateBackup(source);
      setBackup(parsed);
      setChoices({});
      setRestoreDefault(true);
      setError("");
    } catch (cause) {
      setBackup(null);
      setChoices({});
      setError(String(cause instanceof Error ? cause.message : cause));
    }
  }

  async function openBackup() {
    setError("");
    if (!isNative) { fileInput.current?.click(); return; }
    try {
      const path = await open({ multiple: false, filters: [{ name: "映框模板备份", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      receiveBackup(await invoke<string>("read_template_backup", { path }));
    } catch (cause) { setError(`读取备份失败：${String(cause)}`); }
  }

  async function readBrowserFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) { setError("模板备份文件超过 32 MB"); return; }
    try { receiveBackup(await file.text()); }
    catch (cause) { setError(`读取备份失败：${String(cause)}`); }
  }

  async function saveJson(content: string, fileName: string) {
    if (isNative) {
      const path = await save({ defaultPath: fileName, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof path === "string") await invoke("write_template_backup", { path, content });
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function exportBackup() {
    setError("");
    try {
      await saveJson(serializeTemplateBackup(templates, defaultTemplateId), `映框-模板备份-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (cause) { setError(`备份失败：${String(cause)}`); }
  }

  async function exportBuiltIns() {
    setError("");
    try {
      await saveJson(serializeBuiltInCatalog(templates, defaultTemplateId), "builtin-templates.json");
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
  }

  function commitRename(template: TemplateRecord) {
    const name = editingName.trim();
    const issue = templateNameError(name, templates, template.id);
    if (issue) { setError(issue); return; }
    onRename(template.id, name);
    setEditingId("");
    setError("");
  }

  function applyImport() {
    if (!backup) return;
    const decisions: ImportDecision[] = backup.templates.map((template, index) => {
      const conflict = findTemplateConflict(templates, template);
      return { template, conflictId: conflict?.id, choice: conflict ? choices[index] as ImportChoice : "copy" };
    });
    if (decisions.some((decision) => !decision.choice)) { setError("请逐项处理同名或同 ID 的模板"); return; }
    onImport(decisions, backup.defaultTemplateId, restoreDefault);
    setBackup(null);
    setError("");
  }

  const unresolved = backup?.templates.some((template, index) => findTemplateConflict(templates, template) && !choices[index]);

  return <Modal onClose={onClose}>
    <section className="template-manager" role="dialog" aria-modal="true" aria-labelledby="manager-title">
      <div className="template-manager-header"><div><span>可复用的相框与水印布局</span><h2 id="manager-title">模板库</h2></div><button className="icon-button" type="button" aria-label="关闭模板库" onClick={onClose}><X /></button></div>
      <div className="template-manager-toolbar">
        <div><strong>{templates.length} 个模板</strong><span>新照片将使用设为默认的模板；已导入照片不会随模板更新而改变。</span></div>
        <div className="template-manager-toolbar-actions"><button className="button secondary" type="button" onClick={() => void openBackup()}><UploadSimple /> 导入备份</button><button className="button secondary" type="button" onClick={() => void exportBackup()}><DownloadSimple /> 导出完整备份</button><button className="button secondary" type="button" onClick={() => void exportBuiltIns()}><DownloadSimple /> 导出内置文件</button></div>
      </div>
      <input ref={fileInput} className="visually-hidden" type="file" aria-label="导入模板备份文件" tabIndex={-1} accept=".json,application/json" onChange={(event) => void readBrowserFile(event)} />
      {error && <p className="template-manager-error" role="alert">{error}</p>}
      {backup ? <div className="template-manager-body">
        <div className="template-import-heading"><strong>检查导入内容</strong><span>{backup.templates.length} 个模板 · 与现有模板重名或同 ID 时，请逐项选择处理方式</span></div>
        <div className="template-import-list">{backup.templates.map((template, index) => {
          const conflict = findTemplateConflict(templates, template);
          return <div className="template-import-row" key={`${template.id}-${index}`}>
            <TemplatePreview template={template} photo={photo} />
            <div className="template-import-copy"><strong>{template.name}</strong><small>{conflict ? `与现有“${conflict.name}”冲突` : "新增模板"}</small></div>
            {conflict ? <select aria-label={`处理 ${template.name}`} value={choices[index] ?? ""} onChange={(event) => { const choice = event.currentTarget.value as ImportChoice; setChoices((current) => ({ ...current, [index]: choice })); }}><option value="">选择处理方式</option><option value="overwrite">覆盖现有</option><option value="copy">保留副本</option><option value="skip">跳过</option></select> : <span className="template-import-new"><Check /> 新增</span>}
          </div>;
        })}</div>
        <label className="template-restore-default"><input type="checkbox" checked={restoreDefault} onChange={(event) => setRestoreDefault(event.currentTarget.checked)} /><span>同时恢复备份中的新照片默认模板</span></label>
        <div className="template-import-footer"><button className="button secondary" type="button" onClick={() => setBackup(null)}>返回模板库</button><button className="button primary" type="button" disabled={unresolved} onClick={applyImport}>确认导入</button></div>
      </div> : <div className="template-manager-body"><div className="template-manager-list">{templates.map((template) => {
        const changes = template.builtIn ? builtInTemplateChanges(template) : [];
        return <article className="template-manager-row" key={template.id}>
        <TemplatePreview template={template} photo={photo} />
        <div className="template-manager-copy">
          {editingId === template.id ? <div className="template-rename"><input autoFocus className="text-input" aria-label="模板名称" maxLength={maxTemplateNameLength} value={editingName} onChange={(event) => setEditingName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") commitRename(template); if (event.key === "Escape") { event.stopPropagation(); setEditingId(""); } }} /><button className="icon-button" type="button" aria-label="保存名称" onClick={() => commitRename(template)}><FloppyDisk /></button></div> : <strong>{template.name}</strong>}
          <small>{template.description}</small>
          <span>{template.builtIn ? changes.length ? `内置模板 · 本机已修改 ${changes.length} 项` : "内置模板" : "自定义模板"} · {template.layouts.landscape && template.layouts.portrait ? "横竖布局" : template.layouts.landscape ? "横图布局" : "竖图布局"}</span>
        </div>
        <div className="template-manager-actions">
          <button className={`template-default-button ${defaultTemplateId === template.id ? "active" : ""}`} type="button" disabled={defaultTemplateId === template.id} onClick={() => onDefaultChange(template.id)}>{defaultTemplateId === template.id ? <><Check /> 新照片默认</> : "设为新照片默认"}</button>
          <div><button className="icon-button quiet" type="button" aria-label={`复制 ${template.name}`} title="复制模板" onClick={() => onDuplicate(template.id)}><Copy /></button><button className="icon-button quiet" type="button" aria-label={`重命名 ${template.name}`} title="重命名" onClick={() => { setEditingId(template.id); setEditingName(template.name); setError(""); }}><PencilSimple /></button><button className="icon-button quiet" type="button" aria-label={`${template.builtIn ? "重置" : "删除"} ${template.name}`} title={template.builtIn ? "重置内置模板" : "删除模板"} onClick={() => setPendingAction({ id: template.id, type: template.builtIn ? "reset" : "delete" })}><Trash /></button></div>
        </div>
        {changes.length > 0 && <TemplateChanges changes={changes} />}
      </article>;
      })}</div><p className="template-manager-note">发布新版本请使用「导出内置文件」，替换项目的 src/data/builtin-templates.json 并重新构建安装包。「导出完整备份」用于恢复本机模板库，不能替换项目文件。内置文件只包含内置模板，封面使用项目示例图。</p></div>}
      {pendingAction && <Modal className="template-confirm" onClose={() => setPendingAction(null)}><div role="alertdialog" aria-modal="true" aria-labelledby="template-confirm-title"><strong id="template-confirm-title">{pendingAction.type === "reset" ? "重置内置模板？" : "删除自定义模板？"}</strong><p>{pendingAction.type === "reset" ? "模板会恢复项目文件中的内置样式；已套用到照片的单独调整不会改变。" : "模板将从模板库移除；已套用到照片的内容仍保留。"}</p><div><button className="button secondary" type="button" data-modal-initial onClick={() => setPendingAction(null)}>取消</button><button className="button primary" type="button" onClick={() => { pendingAction.type === "reset" ? onReset(pendingAction.id) : onDelete(pendingAction.id); setPendingAction(null); }}>确认</button></div></div></Modal>}
    </section>
  </Modal>;
}
