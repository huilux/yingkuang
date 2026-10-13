// Native-facing rotation workflow. Rust tests verify the actual encoded files.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { cropPixels, rotationDimensions, rotationFrameMapping, mapRotationCrop, normalizedCrop } = await import('/src/photo-crop.ts');
  const { rasterize } = await import('/src/use-preview-backdrop.ts');
  const { calculateGeometry, createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2', saved = localStorage.getItem(key);
  const source = document.createElement('canvas'); source.width = 600; source.height = 400;
  const context = source.getContext('2d'); context.fillStyle = '#ef140a'; context.fillRect(0,0,300,400); context.fillStyle = '#0000fa'; context.fillRect(300,0,300,400);
  const dataUrl = source.toDataURL();
  const photos = ['a','b'].map(id => ({id,path:`/${id}.png`,fileName:`${id}.png`,width:600,height:400,megapixels:.24,thumbnailDataUrl:dataUrl,metadata:{}}));
  const originalCrop = {x:.1,y:.2,width:.6,height:.5};
  localStorage.setItem(key,JSON.stringify({paths:photos.map(p=>p.path),activePath:'/a.png',checkedPaths:photos.map(p=>p.path),cropsByPath:{'/a.png':originalCrop,'/b.png':{x:0,y:0,width:1,height:1,rotation:-90}},exportSettings:{directory:'/tmp',range:'all',size:'original'}}));
  let exported, resolvePhoto;
  mockIPC((command,args) => {
    if(command === 'inspect_images_resilient') return {items:photos.filter(p=>args.paths.includes(p.path)),failures:[]};
    if(command === 'load_editor_photo') return new Promise(resolve => { resolvePhoto = resolve; });
    if(command === 'preflight_export') return {ready:true,total:2,errors:[],warnings:[],estimatedPixels:1,largestWidth:1,largestHeight:1,largestFileName:'a.png'};
    if(command === 'export_images') { exported=args.request; return {total:2,succeeded:2,failed:0,skipped:0,cancelled:false,elapsedMs:20,outputDirectory:'/tmp',failures:[],warnings:[]}; }
  },{shouldMockEvents:true});
  const host=document.createElement('div'); host.style.cssText='position:fixed;inset:0;z-index:1000'; document.body.append(host);
  let root=createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const field=label=>host.querySelector(`.crop-dialog input[aria-label="${label}"]`);
  const snapshot=()=>JSON.parse(localStorage.getItem(key));
  const rect=()=>Object.fromEntries(['左侧位置','顶部位置','选区宽度','选区高度'].map((label,i)=>[['x','y','width','height'][i],Number(field(label).value)]));
  async function setField(label,value) { const input=field(label); input.focus(); t.change(input,value); await t.frame(); input.blur(); await t.frame(); }
  async function open() { (button('调整裁切与旋转')??button('裁切与旋转')).click(); await t.waitFor(()=>field('选区宽度'),'Rotation editor missing'); await t.frame(); }
  async function turn(clockwise=true) { host.querySelector(`[aria-label="向${clockwise?'右':'左'}旋转90度"]`).click(); await t.frame(); }
  async function chooseGuide(text) { host.querySelector('[aria-label="旋转参考线"]').click(); await t.frame(); [...host.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()===text).click(); await t.frame(); }
  const assertRect=(expected,message)=>t.assert(JSON.stringify(rect())===JSON.stringify(expected),`${message}: ${JSON.stringify(rect())}`);
  try {
    const {default:App}=await import(`/src/App.tsx?rotation-regression=${Date.now()}`);
    root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
    await t.waitFor(()=>host.querySelectorAll('.photo-row').length===2,'Photos not restored');
    await open();
    const initial=rect();
    for(let i=0;i<4;i++) await turn();
    assertRect(initial,'Four quarter turns changed selected pixels');
    await turn(); assertRect({x:120,y:60,width:200,height:360},'Clockwise turn lost selected region');
    await turn(false); assertRect(initial,'Reverse quarter turn lost selected region');
    field('水平校正角度').focus(); await t.frame();
    t.assert(host.querySelector('.crop-selection').dataset.grid==='9' && host.querySelector('.crop-center-horizontal'),'Straightening guides missing');
    await setField('水平校正角度',12.5);
    t.assert(host.querySelector('.crop-selection').dataset.grid==='3','Auto guides did not settle');
    button('取消').click(); await t.frame();
    t.assert(JSON.stringify(snapshot().cropsByPath['/a.png'])===JSON.stringify(originalCrop),'Cancel changed applied rotation');
    await open(); button('重置为完整照片').click(); await t.frame();
    const slider=field('水平校正滑块'); slider.focus();
    slider.dispatchEvent(new Event('pointerdown',{bubbles:true}));
    for(const angle of [5,20,45,-45,12.3,0]) { t.change(slider,angle); await t.frame(); t.near(Number(slider.value),angle,'Slider jumps at ±45°',.001); }
    slider.dispatchEvent(new Event('pointerup',{bubbles:true}));
    assertRect({x:0,y:0,width:600,height:400},'Repeated straightening shrank original photo');
    await chooseGuide('隐藏'); t.assert(!host.querySelector('.crop-grid-vertical') && !host.querySelector('.crop-center-horizontal'),'Guide hide failed');
    await chooseGuide('密集网格'); t.assert(host.querySelector('.crop-selection').dataset.grid==='9','Dense guides missing');
    await chooseGuide('自动 · 旋转时加密');
    await turn(); await setField('水平校正角度',13.7);
    const selected=rect();
    const transformed=cropPixels({...photos[0],crop:normalizedCrop(mapRotationCrop({x:0,y:0,width:400,height:600},rotationFrameMapping({width:400,height:600},rotationDimensions(600,400,103.7))),photos[0],103.7)});
    t.assert(JSON.stringify(selected)===JSON.stringify(transformed),'Straightening dimensions mismatch');
    // A late original decode must retain the draft angle and selection.
    resolvePhoto(dataUrl); await t.frame(); await t.frame(); assertRect(selected,'Late image loading reset draft rotation');
    button('归零').click(); await t.frame(); assertRect({x:0,y:0,width:400,height:600},'Fine reset removed quarter turn');
    await setField('水平校正角度',13.7); button('应用调整').click(); await t.frame();
    t.assert(snapshot().cropsByPath['/a.png'].rotation===103.7,'Rotation not persisted');
    const ctx=await t.context(host); await t.waitFor(()=>ctx.stage.findOne('.preview-photo')?.image()?.tagName==='CANVAS','Rotated preview missing');
    const preview=ctx.stage.findOne('.preview-photo'), bitmap=preview.image(), bctx=bitmap.getContext('2d');
    const top=bctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height*.2),1,1).data;
    const bottom=bctx.getImageData(Math.floor(bitmap.width/2),Math.floor(bitmap.height*.8),1,1).data;
    t.assert(top[0]>top[2]*4 && bottom[2]>bottom[0]*4,'Preview rotates in wrong direction');
    const crop=cropPixels({...photos[0],crop:snapshot().cropsByPath['/a.png']}); t.near(preview.width()/preview.height(),crop.width/crop.height,'Rotated preview aspect',.0001);
    t.near(preview.width()/preview.height(),2/3,'Straightening changed crop aspect',.003);
    host.querySelector('[aria-label="撤销"]').click(); await t.frame(); t.assert(!snapshot().cropsByPath['/a.png'].rotation,'Undo did not restore original crop');
    host.querySelector('[aria-label="重做"]').click(); await t.frame(); t.assert(snapshot().cropsByPath['/a.png'].rotation===103.7,'Redo lost rotation');
    button('将当前画布应用到已勾选 2 张').click(); await t.frame();
    t.assert(snapshot().cropsByPath['/b.png'].rotation===-90,'Batch style copied rotation');
    button('重新套用')?.click(); await t.frame(); t.assert(snapshot().cropsByPath['/a.png'].rotation===103.7,'Template reset rotation');
    button('批量导出').click(); await t.frame(); button('预检并开始导出').click(); await t.waitFor(()=>exported,'Export missing');
    t.assert(exported.items[0].crop.rotation===103.7 && exported.items[1].crop.rotation===-90,'Export lost independent rotations');
    host.querySelector('.result-dialog [aria-label="关闭"]').click(); await t.frame();
    root.unmount(); root=createRoot(host); root.render(React.createElement(App));
    await t.waitFor(()=>host.querySelectorAll('.photo-row').length===2,'Restart failed'); await open(); t.near(Number(field('水平校正角度').value),13.7,'Restart lost angle',.001);
    button('重置为完整照片').click(); await t.frame(); button('应用调整').click(); await t.frame();
    t.assert(!snapshot().cropsByPath['/a.png'] && snapshot().cropsByPath['/b.png'].rotation===-90,'Reset affected other photo');
    // Template/backdrop path also uses rotated pixels: right half becomes bottom.
    const sample={...photos[0],crop:{x:0,y:0,width:1,height:.5,rotation:90}};
    const doc=createDefaultDocument(); doc.frame.paddingX=0; doc.frame.paddingY=0; doc.frame.radius=0; doc.frame.shadow=0; doc.frame.type='solid'; Object.values(doc.regions).forEach(region=>region.enabled=false);
    const raster=await rasterize(dataUrl,doc.frame,calculateGeometry(sample,doc),new AbortController().signal,true,560,sample);
    const pixel=raster.getContext('2d').getImageData(Math.floor(raster.width/2),Math.floor(raster.height/2),1,1).data;
    t.assert(pixel[0]>pixel[2]*4,'Template/backdrop ignored rotation before crop');
    return {quarterTurnPixels:true,autoGuides:true,guideModes:true,angleEndpoints:true,noCumulativeCropping:true,cancel:true,lateLoading:true,fineReset:true,previewDirection:true,undoRedo:true,independentBatch:true,exportRequest:true,restart:true,reset:true,rotatedTemplate:true};
  } finally { root.unmount(); host.remove(); clearMocks(); if(saved===null) localStorage.removeItem(key); else localStorage.setItem(key,saved); }
})();
