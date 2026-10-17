// Actual App, shared canvas and generated HD IPC image; no output files.
(async () => {
  const t=await import('/scripts/konva-test-utils.js');
  const {mockIPC,mockWindows,clearMocks}=await import('/node_modules/@tauri-apps/api/mocks.js');
  const {emit}=await import('/node_modules/@tauri-apps/api/event.js');
  const resource=name=>performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(resource('react'));
  const {default:{createRoot}}=await import(resource('react-dom_client'));
  const {createDefaultDocument,calculateGeometry,layerPosition}=await import('/src/editor-model.ts');
  const fontUrl=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/font-library.ts').name;
  await (await import(fontUrl)).ensureFontsLoaded(['Allura','Cinzel','Space Mono']);
  const key='yingkuang-session-v2',saved=localStorage.getItem(key);
  const hd=document.createElement('canvas');hd.width=1200;hd.height=800;
  const paint=hd.getContext('2d');paint.fillStyle='#45695f';paint.fillRect(0,0,1200,800);
  paint.fillStyle='#e0c08e';paint.fillRect(0,0,300,300);paint.fillStyle='#43455a';paint.fillRect(600,400,600,400);
  const hdSource=hd.toDataURL('image/png');
  const photos=[
    {id:'preview-a',path:'/preview-a.png',fileName:'preview-a.png',width:6000,height:4000,megapixels:24,thumbnailDataUrl:'/demo.jpg',metadata:{iso:'ISO100'}},
    {id:'preview-b',path:'/preview-b.png',fileName:'preview-b.png',width:4000,height:6000,megapixels:24,thumbnailDataUrl:'/demo.jpg',metadata:{iso:'ISO12800'}},
  ];
  const design=createDefaultDocument(),base=design.layers[0];
  design.frame.paddingX=8;design.frame.paddingY=9;design.frame.radius=12;
  design.regions.bottom.enabled=true;design.regions.bottom.extra=10;
  design.layers=[0,1,2,3].map(i=>({...base,id:`preview-${i}`,name:`预览文字${i}`,source:i===1?'iso':'custom',customValue:['名字 ming 123','','旋转 ABC 456','隐藏'][i],fontFamily:['Allura','Cinzel','Space Mono','Space Mono'][i],fontSize:28+i*3,visible:i!==3,region:i===2?'canvas':'bottom',rotation:i===2?-90:0,x:.2+i*.25,y:.5,opacity:i===2?.5:1}));
  design.distributions=[{axis:'x',layerIds:design.layers.slice(0,3).map(layer=>layer.id),range:{reference:'canvas',ratio:.6,anchor:.5}}];
  design.alignments=[{action:'center-y',reference:'selection',layerIds:design.layers.slice(0,3).map(layer=>layer.id)}];
  const solid=structuredClone(design);solid.frame.type='solid';solid.frame.color='#eee9df';
  localStorage.setItem(key,JSON.stringify({paths:photos.map(photo=>photo.path),activePath:photos[0].path,
    documentsByPath:{[photos[0].path]:design,[photos[1].path]:solid},cropsByPath:{[photos[1].path]:{x:.1,y:.15,width:.8,height:.7,rotation:90}},
    exportSettings:{directory:'/tmp/preview-test',range:'current'}}));
  let exported,loads=0,failPhoto=false,finishLate,nativeFullscreen=false,failFullscreen=false,finishFullscreen;
  const fullscreenCalls=[];
  mockWindows('main');
  mockIPC((command,args)=>{
    if(command==='plugin:window|is_fullscreen')return nativeFullscreen;
    if(command==='plugin:window|set_fullscreen'){
      fullscreenCalls.push(args.value);
      if(failFullscreen)throw new Error('test: fullscreen denied');
      if(args.value&&finishFullscreen!==undefined)return new Promise(resolve=>{finishFullscreen=()=>{nativeFullscreen=true;resolve();};});
      nativeFullscreen=args.value;return;
    }
    if(command==='inspect_images_resilient')return {items:photos.filter(photo=>args.paths.includes(photo.path)),failures:[]};
    if(command==='load_editor_photo'){
      loads++;if(failPhoto)throw new Error('test: original unavailable');
      if(finishLate!==undefined)return new Promise(resolve=>{finishLate=()=>resolve(hdSource);});
      return hdSource;
    }
    if(command==='list_fonts')return {fonts:[],errors:[]};
    if(command==='preflight_export')return {ready:true,total:1,errors:[],warnings:[],estimatedPixels:1,largestWidth:1,largestHeight:1,largestFileName:'preview.png'};
    if(command==='export_images'){exported=args.request;return {total:1,succeeded:1,failed:0,skipped:0,cancelled:false,outputDirectory:'/tmp/preview-test',failures:[],warnings:[]};}
  },{shouldMockEvents:true});
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2500';document.body.append(host);
  const root=createRoot(host),snapshot=()=>JSON.parse(localStorage.getItem(key));
  const button=(label,scope=host)=>scope.querySelector(`button[aria-label="${label}"]`);
  const dialog=()=>host.querySelector('.result-preview-dialog');
  const camera=ctx=>({x:ctx.world.x(),y:ctx.world.y(),scale:ctx.world.scaleX()});
  const selection=()=>JSON.stringify([...host.querySelectorAll('.layer-main[aria-pressed="true"]')].map(item=>item.getAttribute('aria-label')));
  const keydown=(target,key,options={})=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  let openCount=0;
  async function open(){
    openCount++;
    button('打开成品预览').focus();button('打开成品预览').click();await t.waitFor(dialog,`Preview missing (open ${openCount})`);
    const ctx=await t.context(dialog());
    await t.waitFor(()=>ctx.stage.findOne('.preview-backdrop')&&ctx.stage.findOne('.preview-photo')&&!dialog().querySelector('.canvas-photo-status'),'HD preview not ready');
    return ctx;
  }
  async function setZoom(value){const input=dialog().querySelector('[aria-label="预览缩放比例"]');input.focus();t.change(input,value);await t.frame();keydown(input,'Enter');await t.frame();}
  function pixels(ctx){
    const background=ctx.stage.findOne('.background-world'),frame=background.findOne('Rect'),scale=.25;
    const result=document.createElement('canvas');result.width=Math.ceil(frame.width()*scale);result.height=Math.ceil(frame.height()*scale);
    const context=result.getContext('2d');
    for(const group of [background,ctx.world]){
      const copy=group.clone({x:0,y:0,scaleX:scale,scaleY:scale});
      context.drawImage(copy.toCanvas({x:0,y:0,width:result.width,height:result.height,pixelRatio:1}),0,0);copy.destroy();
    }
    return context.getImageData(0,0,result.width,result.height).data;
  }
  async function assertExportMatchesEditor(editor,photo){
    exported=undefined;[...host.querySelectorAll('.header-actions button')].find(item=>item.textContent.includes('导出当前')).click();await t.frame();
    [...host.querySelectorAll('.export-dialog button')].find(item=>item.textContent.includes('开始导出')).click();await t.waitFor(()=>exported,'Export missing');
    const output=exported.items[0],geometry=calculateGeometry({...photo,crop:output.crop},output.document);
    for(const layer of output.document.layers.filter(layer=>layer.visible)){
      const point=layerPosition(layer,geometry),node=editor.world.findOne(`#${layer.id}`);
      t.near(point.x,node.x(),'Export x after preview',.001);t.near(point.y,node.y(),'Export y after preview',.001);
    }
    const savedDocument=snapshot().documentsByPath[photo.path];
    for(const field of ['distributions','alignments'])t.assert(JSON.stringify(output.document[field])===JSON.stringify(savedDocument[field]),`Export changed ${field}`);
    button('关闭',host.querySelector('.result-dialog')).click();await t.frame();
  }
  const reports=[];
  try {
    const {default:App}=await import(`/src/App.tsx?result-preview=${Date.now()}`);
    root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
    await t.waitFor(()=>host.querySelectorAll('.photo-row').length===2&&host.querySelector('.design-canvas'),'Editor not restored');
    for(const photo of photos){
      button(`预览 ${photo.fileName}`).click();await t.frame();host.querySelector('#tab-watermark').click();await t.frame();
      button('选择图层 预览文字0').click();await t.frame();
      for(const id of [1,2])button(`选择图层 预览文字${id}`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));await t.frame();
      const editor=await t.context(host);
      await t.waitFor(()=>editor.stage.findOne('.preview-backdrop')&&!host.querySelector('.canvas-photo-status'),'Editor HD not ready');
      await t.zoom(editor,83);t.wheel(editor,{deltaX:29,deltaY:17});await t.frame();
      editor.viewport.focus();keydown(editor.viewport,'ArrowRight');await t.frame(); // Real undoable edit.
      const before=JSON.stringify(snapshot()),originalCamera=camera(editor),selected=selection();
      const undo=button('撤销').disabled,redo=button('重做').disabled,preview=await open();
      t.assert(preview.viewport.clientWidth>editor.viewport.clientWidth,'Preview did not gain display space');
      t.assert(!preview.stage.findOne('.overlay-world').visible(),'Preview displays edit guides');
      t.assert(preview.world.find('.watermark-layer').every(node=>!node.draggable()&&!node.isListening()),'Preview permits watermark editing');
      t.assert(preview.stage.findOne('.preview-photo').image().width>=800,'Preview uses only a thumbnail');
      const expected=pixels(editor),actual=pixels(preview);
      t.assert(expected.length===actual.length&&expected.every((value,i)=>value===actual[i]),'Clean preview pixels differ from main canvas');
      const initial=camera(preview);t.wheel(preview,{deltaY:-80});await t.frame();
      t.assert(preview.world.scaleX()>initial.scale,'Plain wheel does not zoom preview');const afterWheel=loads;
      await setZoom(900);t.assert(Number(dialog().querySelector('input').value)===900,'Preview retains editor zoom ceiling');
      preview.viewport.focus();const panX=preview.world.x();keydown(preview.viewport,'ArrowRight');await t.frame();t.near(preview.world.x(),panX-40,'Keyboard does not pan preview',.001);
      for(const key of ['Delete','Backspace','ArrowDown','a','z','y'])keydown(preview.viewport,key,{ctrlKey:['a','z','y'].includes(key)});
      await t.frame();t.assert(JSON.stringify(snapshot())===before,'Preview keyboard changed document/history');
      // Synthetic pointer capture shim; real capture is checked in browser QA.
      const viewport=preview.viewport,capture=viewport.setPointerCapture;viewport.setPointerCapture=()=>{};
      const startX=preview.world.x(),startY=preview.world.y();
      const pointer=(type,x,y)=>viewport.dispatchEvent(new PointerEvent(type,{pointerId:7,isPrimary:true,button:0,bubbles:true,clientX:x,clientY:y}));
      try {pointer('pointerdown',200,200);pointer('pointermove',234,219);pointer('pointerup',234,219);await t.frame();}
      finally {viewport.setPointerCapture=capture;}
      t.near(preview.world.x(),startX+34,'Preview drag x',.001);t.near(preview.world.y(),startY+19,'Preview drag y',.001);
      [...dialog().querySelectorAll('button')].find(item=>item.textContent.includes('适应窗口')).click();await t.frame();
      t.near(preview.world.x(),initial.x,'Fit x',.001);t.near(preview.world.y(),initial.y,'Fit y',.001);t.near(preview.world.scaleX(),initial.scale,'Fit scale',.001);
      t.assert(loads===afterWheel,'Zoom/pan reloaded image pixels');
      const first=button('缩小预览',dialog());first.focus();keydown(first,'Tab',{shiftKey:true});t.assert(document.activeElement===preview.viewport,'Modal does not trap keyboard focus');
      const bounds=dialog().getBoundingClientRect();t.assert(bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1,'Preview exceeds window');
      const chrome=host.querySelector('.window-controls').getBoundingClientRect(),close=button('关闭成品预览',dialog()).getBoundingClientRect();
      t.assert(close.right<=chrome.left||close.top>=chrome.bottom,'Native window controls obscure preview close');
      preview.viewport.focus();keydown(preview.viewport,'Escape');await t.frame();
      t.assert(!dialog(),'Escape did not close preview');t.assert(document.activeElement===button('打开成品预览'),'Focus did not return to preview entry');
      t.assert(JSON.stringify(camera(editor))===JSON.stringify(originalCamera),'Preview changed editor camera');
      t.assert(selection()===selected,'Preview changed selection');
      t.assert(button('撤销').disabled===undo&&button('重做').disabled===redo,'Preview changed undo availability');
      t.assert(JSON.stringify(snapshot())===before,'Preview changed saved data');
      await assertExportMatchesEditor(editor,photo);
      reports.push({photo:photo.fileName,cleanPixelParity:true,largeViewport:true,readOnly:true,wheelAndPointerPan:true,keyboardAndFocus:true,editorStatePreserved:true,exportCoordinates:true});
    }
    const editor=await t.context(host),beforeFullscreen=JSON.stringify(snapshot()),beforeCamera=camera(editor);
    const beforeSelection=selection();
    const beforeHistory={undo:button('撤销').disabled,redo:button('重做').disabled};
    async function assertImageOnly(preview){
      await t.waitFor(()=>nativeFullscreen&&dialog()?.classList.contains('is-fullscreen'),'Native fullscreen not entered');await t.frame();
      const header=dialog().querySelector('header'),footer=dialog().querySelector('footer');
      const assertHidden=()=>{
        t.assert(getComputedStyle(header).display==='none'&&getComputedStyle(footer).display==='none'&&header.inert,'Fullscreen shows controls or leaves them focusable');
        t.assert(getComputedStyle(preview.viewport).cursor==='none','Fullscreen shows cursor');
        t.assert(getComputedStyle(preview.viewport).boxShadow==='none'&&!preview.viewport.title,'Fullscreen shows focus ring or tooltip');
      };
      t.assert(getComputedStyle(host.querySelector('.window-chrome')).display==='none','Native title controls remain over fullscreen');
      t.near(preview.viewport.clientWidth,innerWidth,'Fullscreen viewport width',1);
      t.near(preview.viewport.clientHeight,innerHeight,'Fullscreen viewport height',1);
      const frame=preview.stage.findOne('.background-world').findOne('Rect');
      t.near(Math.max(frame.width()*preview.world.scaleX()/innerWidth,frame.height()*preview.world.scaleY()/innerHeight),1,'Fullscreen retains editor fit margins',.001);
      const expected=pixels(editor),actual=pixels(preview);
      t.assert(expected.length===actual.length&&expected.every((value,i)=>value===actual[i]),'Fullscreen pixels differ from main canvas');
      assertHidden();preview.viewport.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:20,clientY:20}));
      preview.viewport.focus();keydown(preview.viewport,'Tab');await t.frame();assertHidden();
      t.assert(document.activeElement===preview.viewport,'Tab leaves the image-only focus boundary');
    }
    let preview=await open();button('进入全屏预览',dialog()).click();await assertImageOnly(preview);
    preview.viewport.focus();keydown(preview.viewport,'Escape');
    await t.waitFor(()=>!dialog()&&!nativeFullscreen,'Escape did not return directly to editor');
    t.assert(JSON.stringify(snapshot())===beforeFullscreen&&JSON.stringify(camera(editor))===JSON.stringify(beforeCamera),'Fullscreen changed editing data or camera');
    for(const exitKey of ['F11','Escape']){
      editor.viewport.focus();keydown(editor.viewport,'F11');await t.waitFor(dialog,'Direct F11 preview missing');
      preview=await t.context(dialog());
      await t.waitFor(()=>preview.stage.findOne('.preview-backdrop')&&preview.stage.findOne('.preview-photo')&&!dialog().querySelector('.canvas-photo-status'),'Direct fullscreen photo not ready');
      await assertImageOnly(preview);
      t.assert(document.activeElement===preview.viewport,'Direct fullscreen does not focus image');
      keydown(preview.viewport,'F11',{repeat:true});await t.frame();t.assert(dialog()&&nativeFullscreen,'Held F11 immediately closes fullscreen');
      keydown(preview.viewport,exitKey);await t.waitFor(()=>!dialog()&&!nativeFullscreen,`${exitKey} did not close direct fullscreen`);
      t.assert(document.activeElement===editor.viewport,'Shortcut did not return focus to editor');
    }
    editor.viewport.focus();keydown(editor.viewport,'F11',{repeat:true});await t.frame();t.assert(!dialog(),'Repeated editor shortcut opens fullscreen');
    const zoomInput=host.querySelector('[aria-label="缩放比例"]');
    zoomInput.focus();keydown(zoomInput,'F11');await t.frame();t.assert(!dialog(),'Typing field opened fullscreen');
    [...host.querySelectorAll('.header-actions button')].find(item=>item.textContent.includes('模板库')).click();await t.frame();
    const manager=host.querySelector('.template-manager');t.assert(manager,'Template manager missing');
    keydown(manager,'F11');await t.frame();t.assert(!dialog(),'Shortcut opened preview over another dialog');
    keydown(manager,'Escape');await t.frame();
    for(const mode of ['button','escape','direct']){
      failFullscreen=true;const callsBefore=fullscreenCalls.length;
      if(mode==='direct'){
        editor.viewport.focus();keydown(editor.viewport,'F11');await t.waitFor(dialog,'Failed direct preview missing');
        preview=await t.context(dialog());
      }else {preview=await open();button('进入全屏预览',dialog()).click();}
      await t.waitFor(()=>dialog().querySelector('.result-preview-error'),'Fullscreen failure is hidden');
      t.assert(!nativeFullscreen&&!dialog().classList.contains('is-fullscreen'),'Failed fullscreen changed UI mode');
      t.assert(getComputedStyle(dialog().querySelector('header')).display!=='none','Failed direct entry hides recovery controls');
      if(mode==='button'||mode==='direct')button('关闭成品预览',dialog()).click();
      else {preview.viewport.focus();keydown(preview.viewport,'Escape');}
      await t.waitFor(()=>!dialog(),`Cannot close with ${mode} while fullscreen remains denied`);
      t.assert(!nativeFullscreen&&JSON.stringify(fullscreenCalls.slice(callsBefore))==='[true]','Rejected fullscreen was treated as an accepted transition');
      failFullscreen=false;
    }
    for(const exitMode of ['escape','F11','os']){
      preview=await open();const callsBefore=fullscreenCalls.length;
      nativeFullscreen=true;await emit('tauri://resize',{width:innerWidth,height:innerHeight});
      await t.waitFor(()=>dialog().classList.contains('is-fullscreen'),'External fullscreen was not observed');
      if(exitMode==='os'){nativeFullscreen=false;await emit('tauri://resize',{width:innerWidth,height:innerHeight});}
      else {preview.viewport.focus();keydown(preview.viewport,exitMode==='escape'?'Escape':'F11');}
      await t.waitFor(()=>!dialog()&&!nativeFullscreen,'Cannot return to editor after external fullscreen');
      t.assert(JSON.stringify(fullscreenCalls.slice(callsBefore))===(exitMode==='os'?'[]':'[false]'),'Close did not restore initial normal window');
    }
    nativeFullscreen=true;preview=await open();
    await t.waitFor(()=>dialog().classList.contains('is-fullscreen'),'Already-fullscreen window not recognized');
    preview.viewport.focus();keydown(preview.viewport,'Escape');await t.waitFor(()=>!dialog(),'Preview did not close');
    t.assert(nativeFullscreen,'Existing fullscreen state was not restored');nativeFullscreen=false;
    finishFullscreen=()=>{};const callsBefore=fullscreenCalls.length;
    editor.viewport.focus();keydown(editor.viewport,'F11');await t.waitFor(dialog,'Pending direct preview missing');
    preview=await t.context(dialog());await t.waitFor(()=>fullscreenCalls.length>callsBefore,'Pending fullscreen command missing');
    preview.viewport.focus();keydown(preview.viewport,'Escape');await t.frame();
    t.assert(dialog(),'Preview closed before fullscreen transition settled');finishFullscreen();finishFullscreen=undefined;
    await t.waitFor(()=>!dialog()&&!nativeFullscreen,'Late fullscreen completion left window fullscreen');
    t.assert(JSON.stringify(snapshot())===beforeFullscreen&&JSON.stringify(camera(editor))===JSON.stringify(beforeCamera),'Fullscreen recovery changed editing data or camera');
    t.assert(selection()===beforeSelection,'Fullscreen recovery changed selection');
    t.assert(button('撤销').disabled===beforeHistory.undo&&button('重做').disabled===beforeHistory.redo,'Fullscreen recovery changed history');
    // Returning from failed/external fullscreen must leave editing and export usable.
    const node=editor.world.findOne('#preview-0'),point=node.position();
    editor.viewport.focus();keydown(editor.viewport,'ArrowRight');await t.frame();t.near(node.x(),point.x+1,'Editing stopped after fullscreen recovery',.001);
    button('撤销').click();await t.frame();t.near(node.x(),point.x,'Undo stopped after fullscreen recovery',.001);
    t.assert(JSON.stringify(snapshot())===beforeFullscreen,'Editing undo changed saved template layout after fullscreen recovery');
    await assertExportMatchesEditor(editor,photos[1]);
    failPhoto=true;button('打开成品预览').click();await t.waitFor(()=>dialog()?.querySelector('.canvas-photo-status')?.textContent.includes('失败'),'HD failure is hidden');
    button('关闭成品预览',dialog()).click();await t.frame();failPhoto=false;finishLate=()=>{};
    const oldLoads=loads;button('打开成品预览').click();await t.waitFor(()=>loads>oldLoads,'Delayed photo load missing');
    button('关闭成品预览',dialog()).click();await t.frame();finishLate();finishLate=undefined;await t.frame();
    t.assert(!dialog()&&!host.querySelector('.editor-panel').inert,'Late photo response reopened or blocked editor');
    await open();button('关闭成品预览',dialog()).click();await t.frame();
    host.querySelector('.library-clear-button').click();await t.frame();
    [...host.querySelectorAll('.compact-dialog button')].find(item=>item.textContent.includes('确认移除')).click();await t.frame();
    t.assert(button('打开成品预览').disabled,'Empty batch opens preview');
    host.querySelector('.app-shell').focus();keydown(host.querySelector('.app-shell'),'F11');await t.frame();t.assert(!dialog()&&!nativeFullscreen,'Empty batch shortcut opens fullscreen');
    return {scenarios:reports,loadingFailureAndLateResponse:true,emptyBatchDisabled:true,nativeFullscreen:true,imageOnlyFullscreen:true,directF11AndEscape:true,shortcutGuards:true,fullscreenFailureAndRestoration:true,persistentRejectionClosesWithButtonAndEscape:true,externalFullscreenRestoresInitialWindow:true,editingAndExportAfterFullscreenRecovery:true,pendingFullscreenClose:true};
  } finally {root.unmount();host.remove();clearMocks();saved===null?localStorage.removeItem(key):localStorage.setItem(key,saved);}
})();
