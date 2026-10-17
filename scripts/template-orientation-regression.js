// Use shipped layouts and actual fonts; compare automatic orientation changes
// with explicitly reapplying the same template through the real editor.
(async () => {
  const t=await import('/scripts/konva-test-utils.js');
  const {mockIPC,clearMocks}=await import('/node_modules/@tauri-apps/api/mocks.js');
  const resource=name=>performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(resource('react'));
  const {default:{createRoot}}=await import(resource('react-dom_client'));
  const {builtInTemplates}=await import('/src/builtin-template-catalog.ts');
  const {ensureFontsLoaded}=await import('/src/font-library.ts');
  const {resolveBrowserLayout,reorientBrowserTemplateDocument}=await import('/src/browser-layout.ts');
  const {calculateGeometry,layerPosition}=await import('/src/editor-model.ts');
  const templates=builtInTemplates(),template=templates.find(item=>item.id==='wide-float');
  await ensureFontsLoaded([...new Set(templates.flatMap(item=>Object.values(item.layouts).flatMap(doc=>doc.layers.map(layer=>layer.fontFamily))))]);
  const sample=document.createElement('canvas');sample.width=640;sample.height=480;
  const paint=sample.getContext('2d');paint.fillStyle='#45695f';paint.fillRect(0,0,640,480);paint.fillStyle='#e0c08e';paint.fillRect(0,0,320,240);
  const photo={id:'orientation',path:'/orientation.png',fileName:'orientation.png',width:640,height:480,megapixels:.3072,thumbnailDataUrl:sample.toDataURL(),metadata:{iso:'ISO100',focalLength:'50mm',aperture:'f/2.8',shutter:'1/200s',camera:'Panasonic LUMIX',lens:'LEICA 12-60mm',capturedAt:'2026-10-17'}};
  const portraitCrop={x:0,y:0,width:1,height:1,rotation:90};
  let measuredCases=0;
  for(const [width,height] of [[640,480],[641,480],[6000,4000]])for(const iso of ['ISO100','ISO12800'])for(const record of templates)for(const from of ['landscape','portrait']){
    const before={...photo,width,height,metadata:{...photo.metadata,iso},crop:from==='portrait'?portraitCrop:undefined};
    const after={...before,crop:from==='portrait'?undefined:portraitCrop};
    const current=resolveBrowserLayout(record.layouts[from],before),unchanged=JSON.stringify({record,current});
    const actual=resolveBrowserLayout(reorientBrowserTemplateDocument(record,before,after,current),after);
    const expected=resolveBrowserLayout(record.layouts[from==='portrait'?'landscape':'portrait'],after);
    t.assert(JSON.stringify(actual)===JSON.stringify(expected),`Automatic ${record.id} ${from} layout differs from reapply at ${width}x${height} ${iso}`);
    t.assert(JSON.stringify({record,current})===unchanged,'Orientation mutated the template or source document');
    measuredCases++;
  }
  const keys=['yingkuang-session-v2','yingkuang-templates-v3','yingkuang-default-template-v1'];
  const saved=keys.map(key=>[key,localStorage.getItem(key)]);
  localStorage.removeItem(keys[1]);localStorage.setItem(keys[2],template.id);
  localStorage.setItem(keys[0],JSON.stringify({paths:[photo.path],activePath:photo.path,exportSettings:{directory:'/tmp/orientation-test',range:'current'}}));
  let exported;
  mockIPC((command,args)=>{
    if(command==='inspect_images_resilient')return{items:[photo],failures:[]};
    if(command==='load_editor_photo')return photo.thumbnailDataUrl;
    if(command==='list_fonts')return{fonts:[],errors:[]};
    if(command==='preflight_export')return{ready:true,total:1,errors:[],warnings:[],estimatedPixels:1,largestWidth:1,largestHeight:1,largestFileName:photo.fileName};
    if(command==='export_images'){exported=args.request;return{total:1,succeeded:1,failed:0,skipped:0,cancelled:false,outputDirectory:'/tmp/orientation-test',failures:[],warnings:[]};}
  },{shouldMockEvents:true});
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2500';document.body.append(host);
  let root=createRoot(host);
  const snapshot=()=>JSON.parse(localStorage.getItem(keys[0]));
  const documentForPhoto=()=>snapshot().documentsByPath[photo.path];
  // A saved layout can be resolved again on undo/restart. Ignore differences
  // far below a screen pixel, while comparing every layout/style/rule field.
  const comparable=doc=>JSON.stringify(doc,(_key,value)=>typeof value==='number'?Math.round(value*1e9)/1e9:value);
  const button=(label,scope=host)=>scope.querySelector(`button[aria-label="${label}"]`);
  const textButton=text=>[...host.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
  const card=()=>[...host.querySelectorAll('.template-card')].find(item=>item.querySelector('strong')?.textContent===template.name);
  const crop=()=>snapshot().cropsByPath?.[photo.path];
  const assertNodes=(ctx,doc,p,message)=>{
    const geometry=calculateGeometry(p,doc);
    for(const layer of doc.layers.filter(layer=>layer.visible&&(layer.region==='canvas'||doc.regions[layer.region].enabled))){
      const expected=layerPosition(layer,geometry),node=ctx.world.findOne(`#${layer.id}`);
      t.assert(node,`${message}: missing ${layer.id}`);
      t.near(node.x(),expected.x,`${message} x`,.001);t.near(node.y(),expected.y,`${message} y`,.001);
    }
  };
  async function rotate(clockwise){
    (textButton('裁切与旋转')??textButton('调整裁切与旋转')).click();
    await t.waitFor(()=>button('向右旋转90度'),'Crop dialog missing');
    button(clockwise?'向右旋转90度':'向左旋转90度').click();await t.frame();textButton('应用调整').click();await t.frame();
  }
  try{
    const {default:App}=await import(`/src/App.tsx?template-orientation=${Date.now()}`);
    root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
    await t.waitFor(()=>card()&&host.querySelector('.konvajs-content'),'Editor not ready');
    card().click();await t.frame();
    for(const clockwise of [true,false]){
      const before=structuredClone(documentForPhoto()),beforeCrop=JSON.stringify(crop());
      await rotate(clockwise);
      const automatic=structuredClone(documentForPhoto()),afterCrop=JSON.stringify(crop());
      t.assert((crop()?.rotation??0)===(clockwise?90:0),'Rotation was not applied');
      const p={...photo,crop:crop()},ctx=await t.context(host);
      assertNodes(ctx,automatic,p,'Main canvas after automatic orientation');
      button('撤销').click();await t.frame();
      t.assert(comparable(documentForPhoto())===comparable(before)&&JSON.stringify(crop())===beforeCrop,'Undo did not restore crop and layout together');
      button('重做').click();await t.frame();
      t.assert(comparable(documentForPhoto())===comparable(automatic)&&JSON.stringify(crop())===afterCrop,'Redo did not restore crop and layout together');
      card().click();await t.frame();
      t.assert(comparable(documentForPhoto())===comparable(automatic),'Rotation keeps old layout until the template is clicked again');
    }
    await rotate(true);
    const automatic=structuredClone(documentForPhoto()),rotatedPhoto={...photo,crop:crop()};
    const editor=await t.context(host);assertNodes(editor,automatic,rotatedPhoto,'Rotated main canvas');
    button('打开成品预览').click();await t.waitFor(()=>host.querySelector('.result-preview-dialog'),'Preview missing');
    const preview=await t.context(host.querySelector('.result-preview-dialog'));
    assertNodes(preview,automatic,rotatedPhoto,'Rotated result preview');
    button('关闭成品预览').click();await t.frame();
    textButton('导出当前').click();await t.frame();
    [...host.querySelectorAll('.export-dialog button')].find(item=>item.textContent.includes('开始导出')).click();
    await t.waitFor(()=>exported,'Export missing');
    t.assert(comparable(exported.items[0].document)===comparable(automatic),'Export does not use automatic portrait layout');
    t.assert(exported.items[0].crop.rotation===90,'Export lost the rotation');
    assertNodes(editor,exported.items[0].document,rotatedPhoto,'Export positions');
    button('关闭',host.querySelector('.result-dialog')).click();await t.frame();
    root.unmount();root=createRoot(host);root.render(React.createElement(App));
    await t.waitFor(()=>card()&&host.querySelector('.konvajs-content'),'Restart did not restore photo');
    t.assert(comparable(documentForPhoto())===comparable(automatic)&&crop().rotation===90,'Restart changed the automatic portrait layout');
    card().click();await t.frame();t.assert(comparable(documentForPhoto())===comparable(automatic),'Restored portrait layout changes on reapply');
    return{measuredCases,landscapeToPortrait:true,portraitToLandscape:true,reapplyUnchanged:true,sourceDocumentsPreserved:true,undoRedoTogether:true,mainPreviewAndExport:true,restart:true};
  }finally{root.unmount();host.remove();clearMocks();for(const[key,value]of saved)value===null?localStorage.removeItem(key):localStorage.setItem(key,value);}
})();
