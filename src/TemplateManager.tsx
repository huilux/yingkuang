import { SelectControl } from "./SelectControl";
import { useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Check, Copy, DownloadSimple, FloppyDisk, PencilSimple, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { TemplatePreview } from "./TemplatePreview";
import { builtInTemplateChanges, serializeBuiltInCatalog, type BuiltInTemplateCatalog } from "./builtin-template-catalog";
import type { TemplateUpdates } from "./use-template-updates";
import type { OverrideBases } from "./template-library";
import { diffTemplates } from "./template-diff";
import { maxTemplateNameLength, templateNameError, findTemplateConflict, parseTemplateBackup, serializeTemplateBackup, type ImportChoice, type ImportDecision, type TemplateBackup } from "./template-library";
import type { TemplateChange } from "./template-diff";
import type { PhotoAsset, TemplateRecord } from "./types";

type Props = {
  templates: TemplateRecord[];
  officialCatalog: BuiltInTemplateCatalog;
  overrideBases: OverrideBases;
  updates: TemplateUpdates;
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

function TemplateChanges({ changes,localLabel="本机当前" }: { changes: TemplateChange[];localLabel?:string }) {
  const groups = [...new Set(changes.map((change) => change.group))];
  return <details className="template-diff">
    <summary>查看与原版模板的 {changes.length} 项差异</summary>
    <div className="template-diff-content">
      {groups.map((group) => <section key={group}>
        <h3>{group}</h3>
        <dl>{changes.filter((change) => change.group === group).map((change, index) => <div key={`${change.field}-${index}`} className="template-diff-field">
          <dt>{change.field}</dt>
          <dd><span><small>原版</small><code title={change.builtInValue}>{change.builtInValue}</code></span><span aria-hidden="true">→</span><span><small>{localLabel}</small><code title={change.localValue}>{change.localValue}</code></span></dd>
        </div>)}</dl>
      </section>)}
    </div>
  </details>;
}

export function TemplateManager({ templates, officialCatalog, overrideBases, updates, defaultTemplateId, photo, onClose, onDefaultChange, onRename, onDuplicate, onDelete, onReset, onImport }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<TemplateBackup | null>(null);
  const [choices, setChoices] = useState<Record<number, ImportChoice | "">>({});
  const [restoreDefault, setRestoreDefault] = useState(true);
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [pendingAction, setPendingAction] = useState<{ id: string; type: "delete" | "reset" } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "official" | "personal">("all");
  const [confirmRollback, setConfirmRollback] = useState(false);

  async function openOfficialPackage() {
    setError("");
    try {
      const path = await open({ multiple: false, filters: [{ name: "映框官方模板包", extensions: ["json"] }] });
      if (typeof path === "string") await updates.importPackage(await invoke<string>("read_template_backup", { path }));
    } catch (cause) { setError(String(cause)); }
  }

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
      await saveJson(serializeBuiltInCatalog(templates, defaultTemplateId, officialCatalog), "builtin-templates.json");
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
      <div className="template-update-panel" aria-label="官方模板更新">
        <div className="template-update-heading"><div><strong>官方模板 · {updates.current.version}</strong><small>检查更新时联网，下载后可离线使用。照片与个人模板保留在本机。</small></div><button className="button secondary" type="button" disabled={!updates.native || !updates.ready || updates.busy} onClick={() => void updates.check()}>{updates.busy ? "正在处理…" : "检查更新"}</button></div>
        <div className="template-update-actions"><button type="button" disabled={!updates.native || !updates.ready || updates.busy || !updates.canApply} onClick={() => void openOfficialPackage()}>导入官方模板包</button>{updates.previousVersion && <button type="button" disabled={updates.busy || !updates.canApply} onClick={() => setConfirmRollback(true)}>恢复上一版 · {updates.previousVersion}</button>}</div>
        {updates.candidate && <div className="template-update-candidate"><strong>发现新版 · {updates.candidate.index.version}</strong><p>{updates.candidate.index.notes || "官方模板有更新"}</p><small>{updates.candidate.index.templateCount} 个官方模板 · {(updates.candidate.index.bytes / 1024).toFixed(1)} KB · 本机修改和已编辑照片保持不变</small><button className="button primary" type="button" disabled={updates.busy || !updates.canApply || !updates.candidate.signed.compatible} onClick={() => void updates.install()}>更新官方模板</button></div>}
        {!updates.native && <p>在线更新与官方模板包导入在桌面版中提供。</p>}
        {updates.message && <p role="status">{updates.message}</p>}{updates.error && <p className="template-update-error" role="alert">{updates.error}</p>}
      </div>
      {error && <p className="template-manager-error" role="alert">{error}</p>}
      {backup ? <div className="template-manager-body">
        <div className="template-import-heading"><strong>检查导入内容</strong><span>{backup.templates.length} 个模板 · 与现有模板重名或同 ID 时，请逐项选择处理方式</span></div>
        <div className="template-import-list">{backup.templates.map((template, index) => {
          const conflict = findTemplateConflict(templates, template);
          return <div className="template-import-row" key={`${template.id}-${index}`}>
            <TemplatePreview template={template} photo={photo} />
            <div className="template-import-copy"><strong>{template.name}</strong><small>{conflict ? `与现有“${conflict.name}”冲突` : "新增模板"}</small></div>
            {conflict ? <SelectControl aria-label={`处理 ${template.name}`} value={choices[index] ?? ""} onChange={(event) => { const choice = event.currentTarget.value as ImportChoice; setChoices((current) => ({ ...current, [index]: choice })); }}><option value="">选择处理方式</option><option value="overwrite">覆盖现有</option><option value="copy">保留副本</option><option value="skip">跳过</option></SelectControl> : <span className="template-import-new"><Check /> 新增</span>}
          </div>;
        })}</div>
        <label className="template-restore-default"><input type="checkbox" checked={restoreDefault} onChange={(event) => setRestoreDefault(event.currentTarget.checked)} /><span>同时恢复备份中的新照片默认模板</span></label>
        <div className="template-import-footer"><button className="button secondary" type="button" onClick={() => setBackup(null)}>返回模板库</button><button className="button primary" type="button" disabled={unresolved} onClick={applyImport}>确认导入</button></div>
      </div> : <div className="template-manager-body"><div className="template-library-filters" role="group" aria-label="模板来源">{([["all", "全部"], ["official", "官方模板"], ["personal", "我的模板"]] as const).map(([value, label]) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="template-manager-list">{templates.filter(template => filter === "all" || (filter === "official" ? template.builtIn : !template.builtIn)).map((template) => {
        const changes = template.builtIn ? overrideBases[template.id] ? diffTemplates(overrideBases[template.id], template) : builtInTemplateChanges(template, officialCatalog) : [];
        const latest = officialCatalog.templates.find(item => item.id === template.id);
        const upstream = overrideBases[template.id] && latest ? diffTemplates(overrideBases[template.id], latest) : [];
        return <article className="template-manager-row" key={template.id}>
        <TemplatePreview template={template} photo={photo} />
        <div className="template-manager-copy">
          {editingId === template.id ? <div className="template-rename"><input autoFocus className="text-input" aria-label="模板名称" maxLength={maxTemplateNameLength} value={editingName} onChange={(event) => setEditingName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") commitRename(template); if (event.key === "Escape") { event.stopPropagation(); setEditingId(""); } }} /><button className="icon-button" type="button" aria-label="保存名称" onClick={() => commitRename(template)}><FloppyDisk /></button></div> : <strong>{template.name}</strong>}
          <small>{template.description}</small>
          <span>{template.builtIn ? changes.length || overrideBases[template.id] ? `官方模板 · 本机版本${changes.length ? ` · 已修改 ${changes.length} 项` : ""}` : "官方模板" : "自定义模板"} · {template.layouts.landscape && template.layouts.portrait ? "横竖布局" : template.layouts.landscape ? "横图布局" : "竖图布局"}</span>
          {upstream.length > 0 && <details className="template-upstream"><summary>官方新版有 {upstream.length} 项变化，本机修改已保留</summary><TemplatePreview template={latest!} /><TemplateChanges changes={upstream} localLabel="官方新版" /><p>使用“重置”可恢复当前官方版本。</p></details>}
        </div>
        <div className="template-manager-actions">
          <button className={`template-default-button ${defaultTemplateId === template.id ? "active" : ""}`} type="button" disabled={defaultTemplateId === template.id} onClick={() => onDefaultChange(template.id)}>{defaultTemplateId === template.id ? <><Check /> 新照片默认</> : "设为新照片默认"}</button>
          <div><button className="icon-button quiet" type="button" aria-label={`复制 ${template.name}`} title="复制模板" onClick={() => onDuplicate(template.id)}><Copy /></button><button className="icon-button quiet" type="button" aria-label={`重命名 ${template.name}`} title="重命名" onClick={() => { setEditingId(template.id); setEditingName(template.name); setError(""); }}><PencilSimple /></button><button className="icon-button quiet" type="button" aria-label={`${template.builtIn ? "重置" : "删除"} ${template.name}`} title={template.builtIn ? "重置内置模板" : "删除模板"} onClick={() => setPendingAction({ id: template.id, type: template.builtIn ? "reset" : "delete" })}><Trash /></button></div>
        </div>
        {changes.length > 0 && <TemplateChanges changes={changes} />}
      </article>;
      })}</div><p className="template-manager-note">官方更新保留本机修改；重置会恢复当前官方样式。完整备份用于保存你的模板库，官方模板包用于离线更新官方模板。</p></div>}
      {confirmRollback && <Modal className="template-confirm" onClose={() => setConfirmRollback(false)}><div role="alertdialog" aria-modal="true" aria-labelledby="template-rollback-title"><strong id="template-rollback-title">恢复上一版官方模板？</strong><p>恢复到 {updates.previousVersion}，个人模板、本机修改和已编辑照片会保留。</p><div><button className="button secondary" type="button" data-modal-initial onClick={() => setConfirmRollback(false)}>取消</button><button className="button primary" type="button" onClick={() => { setConfirmRollback(false); void updates.rollback(); }}>确认恢复</button></div></div></Modal>}
      {pendingAction && <Modal className="template-confirm" onClose={() => setPendingAction(null)}><div role="alertdialog" aria-modal="true" aria-labelledby="template-confirm-title"><strong id="template-confirm-title">{pendingAction.type === "reset" ? "重置内置模板？" : "删除自定义模板？"}</strong><p>{pendingAction.type === "reset" ? "模板会恢复项目文件中的内置样式；已套用到照片的单独调整不会改变。" : "模板将从模板库移除；已套用到照片的内容仍保留。"}</p><div><button className="button secondary" type="button" data-modal-initial onClick={() => setPendingAction(null)}>取消</button><button className="button primary" type="button" onClick={() => { pendingAction.type === "reset" ? onReset(pendingAction.id) : onDelete(pendingAction.id); setPendingAction(null); }}>确认</button></div></div></Modal>}
    </section>
  </Modal>;
}
