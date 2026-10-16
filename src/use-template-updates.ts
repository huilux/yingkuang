import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {officialTemplateConfig,parseTemplateIndex,unpackOfficialTemplates,type OfficialTemplatePackage,type SignedTemplateIndex,type TemplateIndex} from "./official-templates";
import type {BuiltInTemplateCatalog} from "./builtin-template-catalog";

type CacheStatus = {current:OfficialTemplatePackage|null;previousVersion:string|null;issue:string|null};
type Checked = SignedTemplateIndex & {compatible:boolean};
export type TemplateUpdates = ReturnType<typeof useTemplateUpdates>;

export function useTemplateUpdates(apply:(catalog:BuiltInTemplateCatalog)=>void,canApply:boolean,initial:BuiltInTemplateCatalog) {
  const native = "__TAURI_INTERNALS__" in window;
  const applyRef=useRef(apply);applyRef.current=apply;
  const allowedRef=useRef(canApply);allowedRef.current=canApply;
  const alive=useRef(true);
  const [current,setCurrent]=useState({version:initial.contentVersion??officialTemplateConfig.bundledVersion,revision:initial.revision??officialTemplateConfig.bundledRevision});
  const [previousVersion,setPreviousVersion]=useState<string|null>(null);
  const [candidate,setCandidate]=useState<{signed:Checked;index:TemplateIndex}|null>(null);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [ready,setReady]=useState(!native);

  function accept(status:CacheStatus|undefined) {
    if(!status || !alive.current)return;
    if(status.current) {
      const {catalog,index}=unpackOfficialTemplates(status.current);
      if(!allowedRef.current)throw new Error("本机模板库需要先恢复或导出备份，已保留原记录");
      applyRef.current(catalog);
      setCurrent({version:index.version,revision:index.revision});
    }
    setPreviousVersion(status.previousVersion);
    if(status.issue)setError(status.issue);
  }

  useEffect(()=>{
    alive.current=true;
    let cancelled=false;
    if(native) void invoke<CacheStatus>("read_official_templates").then(status=>{if(!cancelled)accept(status);}).catch(cause=>{if(!cancelled)setError(String(cause));}).finally(()=>{if(!cancelled)setReady(true);});
    return()=>{cancelled=true;alive.current=false;};
  },[native]);

  async function task(work:()=>Promise<void>) {
    if(!native || busyRef.current || !ready)return;
    busyRef.current=true;setBusy(true);setError("");setMessage("");
    try {await work();}catch(cause){if(alive.current)setError(String(cause));}
    finally{busyRef.current=false;if(alive.current)setBusy(false);}
  }
  function check() {return task(async()=>{
    const signed=await invoke<Checked>("check_template_update");
    const index=parseTemplateIndex(signed.index);
    if(!alive.current)return;
    if(index.revision<=current.revision){setCandidate(null);setMessage("官方模板已是最新版本");}
    else {setCandidate({signed,index});if(!signed.compatible)setMessage(`新版模板需要映框 ${index.minAppVersion} 或更高版本`);}
  });}
  function install() {return task(async()=>{
    if(!candidate || !allowedRef.current)return;
    const status=await invoke<CacheStatus>("install_template_update",{signed:{index:candidate.signed.index,signature:candidate.signed.signature}});
    accept(status);if(alive.current){setCandidate(null);setMessage("官方模板已更新，本机修改和已编辑照片已保留");}
  });}
  function importPackage(source:string) {return task(async()=>{
    if(!allowedRef.current)return;
    accept(await invoke<CacheStatus>("import_official_templates",{source}));
    if(alive.current){setCandidate(null);setMessage("已离线导入官方模板包，本机修改已保留");}
  });}
  function rollback() {return task(async()=>{
    if(!allowedRef.current)return;
    accept(await invoke<CacheStatus>("rollback_official_templates"));
    if(alive.current){setCandidate(null);setMessage("已恢复上一版官方模板，本机修改已保留");}
  });}
  return {native,current,previousVersion,candidate,busy,message,error,ready,canApply,check,install,importPackage,rollback};
}
