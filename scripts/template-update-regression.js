(async()=>{
  const t=await import('/scripts/konva-test-utils.js');
  const {mockIPC,clearMocks}=await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl=name=>performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(moduleUrl('react'));
  const {default:{createRoot}}=await import(moduleUrl('react-dom_client'));
  const {bundledCatalog}=await import('/src/builtin-template-catalog.ts');
  const {serializeUserTemplates}=await import('/src/template-library.ts');
  const keys=['yingkuang-session-v2','yingkuang-templates-v3','yingkuang-templates-v2','yingkuang-default-template-v1'];
  const saved=keys.map(key=>[key,localStorage.getItem(key)]);keys.forEach(key=>localStorage.removeItem(key));
  const original=bundledCatalog(), modified=structuredClone(original.templates[0]);modified.name='保留我的修改';
  const personal={...structuredClone(original.templates[1]),id:'new-official',name:'我的私人模板',builtIn:false};
  localStorage.setItem(keys[1],serializeUserTemplates([modified,...original.templates.slice(1),personal],original));
  localStorage.setItem(keys[3],personal.id);
  localStorage.setItem(keys[0],JSON.stringify({paths:['update-photo.jpg'],activePath:'update-photo.jpg',documentsByPath:{'update-photo.jpg':modified.layouts.landscape},templateIdsByPath:{'update-photo.jpg':modified.id}}));
  const next=structuredClone(original);next.revision=2;next.contentVersion='2099.1.2';next.templates[0].name='官方第一模板新版';next.templates[1].name='官方第二模板新版';
  next.templates.push({...structuredClone(original.templates[0]),id:'new-official',name:'官方新增模板'});
  const catalog=JSON.stringify(next), bytes=new TextEncoder().encode(catalog);
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const index=JSON.stringify({format:'yingkuang-template-feed',schemaVersion:1,revision:2,version:next.contentVersion,minAppVersion:'0.5.9-beta.1',path:`releases/${next.contentVersion}/templates.json`,sha256,bytes:bytes.length,templateCount:next.templates.length,notes:'测试官方更新',fonts:['Space Mono']});
  // IPC responses model packages already verified by the native boundary.
  const pack={format:'yingkuang-official-template-package',version:1,index,signature:'bmF0aXZlLXZlcmlmaWVk',catalog};
  const originalPack=await fetch('/template-feed/releases/2026.10.1/official-templates.json').then(r=>r.json());
  let current=null,failInstall=true,offline=false,networkChecks=0,imports=0;
  mockIPC(command=>{
    if(command==='inspect_images_resilient')return {items:[{id:'update-photo',path:'update-photo.jpg',fileName:'update-photo.jpg',width:600,height:400,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{}}],failures:[]};
    if(command==='read_official_templates')return {current,previousVersion:null,issue:null};
    if(command==='check_template_update'){networkChecks++;if(offline)throw new Error('网络不可用');return {index,signature:pack.signature,compatible:true};}
    if(command==='install_template_update'){if(failInstall)throw new Error('模板下载中断');current=pack;return {current,previousVersion:'2026.10.1',issue:null};}
    if(command==='rollback_official_templates'){current=originalPack;return {current,previousVersion:null,issue:null};}
    if(command==='plugin:dialog|open')return 'official-package.json';
    if(command==='read_template_backup')return JSON.stringify(pack);
    if(command==='import_official_templates'){imports++;current=pack;return {current,previousVersion:'2026.10.1',issue:null};}
  },{shouldMockEvents:true});
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2500';document.body.append(host);
  let root=createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const stored=()=>JSON.parse(localStorage.getItem(keys[1]));
  const openManager=async()=>{await t.waitFor(()=>button('模板库'),'Editor missing');button('模板库').click();await t.waitFor(()=>button('检查更新')&&!button('检查更新').disabled,'Official cache not ready');};
  const assertProtected=photo=>{
    const library=stored();t.assert(library.overrides.find(x=>x.id===modified.id)?.name===modified.name,'Official update overwrote local edits');
    t.assert(library.custom.some(x=>x.name===personal.name && JSON.stringify(x.layouts)===JSON.stringify(personal.layouts)),'Official update overwrote a personal ID collision');
    t.assert(library.custom.some(x=>x.id===library.defaultTemplateId),'Update reset the personal default');
    t.assert(JSON.stringify(JSON.parse(localStorage.getItem(keys[0])).documentsByPath['update-photo.jpg'])===photo,'Update changed an already-edited photo');
  };
  try {
    const {default:App}=await import(`/src/App.tsx?template-update=${Date.now()}`);
    root.render(React.createElement(App));await t.context(host);await openManager();
    const photo=JSON.stringify(JSON.parse(localStorage.getItem(keys[0])).documentsByPath['update-photo.jpg']);
    t.assert(networkChecks===0,'Startup contacted the remote template source');
    button('检查更新').click();await t.waitFor(()=>button('更新官方模板'),'Update not offered');
    const before=localStorage.getItem(keys[1]);button('更新官方模板').click();await t.waitFor(()=>host.querySelector('.template-update-error'),'Download failure not shown');
    t.assert(localStorage.getItem(keys[1])===before,'Failed download changed the template library');
    failInstall=false;button('更新官方模板').click();await t.waitFor(()=>stored().catalog.revision===2,'Update not installed');assertProtected(photo);
    t.assert(stored().catalog.templates.some(x=>x.name==='官方第二模板新版'),'Untouched official template did not update');
    const personalDefault=stored().defaultTemplateId;
    const chooseDefault=async id=>{const field=host.querySelector('select[aria-label="新照片使用模板"]');field.value=id;field.dispatchEvent(new Event('change',{bubbles:true}));await t.frame();};
    await chooseDefault('new-official');
    root.unmount();root=createRoot(host);root.render(React.createElement(App));await t.context(host);await openManager();
    t.assert(stored().defaultTemplateId==='new-official','Restart remapped an explicit choice of the official ID');
    await chooseDefault(personalDefault);assertProtected(photo);
    offline=true;button('检查更新').click();await t.waitFor(()=>host.querySelector('.template-update-error'),'Offline failure missing');assertProtected(photo);
    // A fresh mount obtains previous-version availability from native cache.
    current=null;root.unmount();root=createRoot(host);root.render(React.createElement(App));await t.context(host);await openManager();
    offline=false;button('检查更新').click();await t.frame();
    // Use the offline file import path without any network request.
    offline=true;const checks=networkChecks;button('导入官方模板包').click();await t.waitFor(()=>imports===1,'Offline import did not finish');
    await t.waitFor(()=>button('恢复上一版 · 2026.10.1'),'Rollback missing');t.assert(networkChecks===checks,'Offline import contacted network');
    button('恢复上一版 · 2026.10.1').click();await t.frame();button('确认恢复').click();await t.waitFor(()=>stored().catalog.revision===1,'Rollback not applied');assertProtected(photo);
    return {noStartupNetwork:true,failedDownloadRetained:true,localEditsPreserved:true,personalCollisionAndDefaultPreserved:true,explicitOfficialChoicePreserved:true,editedPhotoUnchanged:true,restartOffline:true,offlineImport:true,rollback:true};
  }finally{root.unmount();host.remove();clearMocks();saved.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));}
})();
