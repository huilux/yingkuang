// Use the real inspector, canvas, history, template persistence and export IPC.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const {mockIPC,clearMocks} = await import('/node_modules/@tauri-apps/api/mocks.js');
  const resource = name => performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React} = await import(resource('react'));
  const {default:{createRoot}} = await import(resource('react-dom_client'));
  const libraryUrl = performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/font-library.ts').name;
  const {ensureFontsLoaded} = await import(libraryUrl);
  const {builtInTemplates} = await import('/src/builtin-template-catalog.ts');
  const {calculateGeometry,layerPosition} = await import('/src/editor-model.ts');
  const {positionPatch,unionBounds} = await import('/src/selection-model.ts');
  const keys=['yingkuang-session-v2','yingkuang-templates-v3','yingkuang-default-template-v1'];
  const saved=keys.map(key=>[key,localStorage.getItem(key)]), reports=[];
  const ids=['line-0','line-1','line-2'];
  const photos=[
    {id:'line-a',path:'line-a.jpg',fileName:'line-a.jpg',width:600,height:400,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{iso:'ISO100'}},
    {id:'line-b',path:'line-b.jpg',fileName:'line-b.jpg',width:400,height:600,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{iso:'ISO12800'}},
  ];
  await ensureFontsLoaded(['Allura','Cinzel','Space Mono']);
  try {
    for (const axis of ['x','y']) {
      const other=axis==='x'?'y':'x',label=axis==='x'?'对齐成一行':'对齐成一列';
      const rangeLabel=axis==='x'?'占用宽度':'占用高度';
      const template=structuredClone(builtInTemplates().find(item=>item.id==='wide-float'));
      template.id=`line-fixture-${axis}`;template.name=`行列对齐-${axis}`;template.builtIn=false;
      const design=template.layouts.landscape,base=design.layers[0];
      design.frame.paddingX=5;design.frame.paddingY=5;
      for(const region of Object.values(design.regions)){region.enabled=true;region.extra=8;}
      delete design.distributions;delete design.alignments;delete template.layouts.portrait;
      design.layers=Array.from({length:4},(_,i)=>({...base,id:`line-${i}`,name:`对齐${i}`,source:i===1?'iso':'custom',customValue:['名字','','ming 123','保留'][i],fontFamily:['Allura','Cinzel','Space Mono','Space Mono'][i],fontSize:26+i*9,fontWeight:400,visible:true,rotation:i===1?90:0,region:i===1?'bottom':'canvas',x:.5,y:.5}));
      const geometry=calculateGeometry(photos[0],design);
      design.layers.forEach((layer,i)=>Object.assign(layer,positionPatch(layer,{x:axis==='x'?250+i*270:600+i*13,y:axis==='y'?200+i*230:650+i*17},geometry).patch));
      localStorage.setItem(keys[0],JSON.stringify({paths:photos.map(photo=>photo.path),activePath:photos[0].path,exportSettings:{directory:'/tmp/line-alignment-test',range:'current'}}));
      localStorage.setItem(keys[1],JSON.stringify({version:2,overrides:[],custom:[template]}));
      localStorage.setItem(keys[2],template.id);
      let exported;
      mockIPC((command,args)=>{
        if(command==='inspect_images_resilient')return {items:photos.filter(photo=>args.paths.includes(photo.path)),failures:[]};
        if(command==='preflight_export')return {ready:true,total:1,estimatedPixels:1000000,largestWidth:1200,largestHeight:900,largestFileName:'line.jpg',errors:[],warnings:[]};
        if(command==='export_images'){exported=args.request;return {total:1,succeeded:1,failed:0,skipped:0,cancelled:false,outputDirectory:'/tmp/line-alignment-test',failures:[],warnings:[]};}
        if(command==='list_fonts')return {fonts:[],errors:[]};
      },{shouldMockEvents:true});
      const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2500';document.body.append(host);
      let root=createRoot(host);
      const button=text=>[...host.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
      const stored=path=>JSON.parse(localStorage.getItem(keys[0])).documentsByPath[path];
      const selectAll=async()=>{
        host.querySelector('#tab-watermark').click();await t.frame();
        for(const i of [2,1,0])host.querySelector(`[aria-label="选择图层 对齐${i}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i!==2}));
        await t.frame();
      };
      const positions=ctx=>ids.map(id=>ctx.world.findOne(`#${id}`).position());
      const assertLine=ctx=>{
        const points=positions(ctx);points.forEach(point=>t.near(point[other],points[0][other],'Elements are not in one line',.001));
        return points;
      };
      const setNumber=async(label,value)=>{
        const input=host.querySelector(`input[aria-label="${label}"]`);input.focus();t.change(input,value);await t.frame();
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await t.frame();
      };
      try {
        const {default:App}=await import(`/src/App.tsx?line-alignment=${axis}-${Date.now()}`);
        root.render(React.createElement(App));
        await t.waitFor(()=>host.querySelector('.template-card-copy strong')&&host.querySelector('.konvajs-content'),'Line editor not ready');
        [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click();await t.frame();
        await selectAll();
        t.assert(button(label),'Direct row/column alignment button is missing');
        t.assert(!button(label).disabled,'Skewed elements cannot be aligned');
        const reference=host.querySelector('select[aria-label="对齐参照"]');reference.value='photo';reference.dispatchEvent(new Event('change',{bubbles:true}));await t.frame();
        let ctx=await t.context(host);
        const before=positions(ctx), foreign=ctx.world.findOne('#line-3').position();
        const beforeDocument=structuredClone(stored(photos[0].path));
        const measured=ids.map(id=>({bounds:ctx.world.findOne(`#${id}`).findOne('Text').getClientRect({relativeTo:ctx.world})}));
        const group=unionBounds(measured),target=group[other]+group[other==='x'?'width':'height']/2;
        button(label).click();await t.frame();
        let aligned=assertLine(ctx);
        aligned.forEach((point,i)=>{t.near(point[other],target,'Alignment moved to the photo instead of the selection',.001);t.near(point[axis],before[i][axis],'Parallel position changed',.001);});
        t.assert(reference.value==='photo','Shortcut changed the reference dropdown');
        t.assert(JSON.stringify(ctx.world.findOne('#line-3').position())===JSON.stringify(foreign),'Unselected layer moved');
        t.assert(stored(photos[0].path).alignments.some(rule=>rule.action===(axis==='x'?'center-y':'center-x')&&rule.reference==='selection'),'Line rule was not persisted');
        for(const layer of stored(photos[0].path).layers){const original=beforeDocument.layers.find(item=>item.id===layer.id);const {x,y,...style}=layer,{x:oldX,y:oldY,...oldStyle}=original;t.assert(JSON.stringify(style)===JSON.stringify(oldStyle),'Alignment changed content, style, order or region');}
        host.querySelector('[aria-label="撤销"]').click();await t.frame();
        positions(ctx).forEach((point,i)=>{t.near(point.x,before[i].x,'Row/column undo x',.001);t.near(point.y,before[i].y,'Row/column undo y',.001);});
        host.querySelector('[aria-label="重做"]').click();await t.frame();assertLine(ctx);
        await setNumber(`${rangeLabel}百分比`,60);
        const range=JSON.stringify(stored(photos[0].path).distributions);
        host.querySelector('[aria-label="选择图层 对齐1"]').click();await t.frame();
        const coordinate=other==='x'?'X 坐标':'Y 坐标';
        await setNumber(coordinate,Number(host.querySelector(`input[aria-label="${coordinate}"]`).value)+3);
        await selectAll();
        t.assert(!host.querySelector(`input[aria-label="${rangeLabel}"]`),'Crooked line still exposes a distribution slider');
        const beforeRealign=positions(ctx);button(label).click();await t.frame();aligned=assertLine(ctx);
        aligned.forEach((point,i)=>t.near(point[axis],beforeRealign[i][axis],'Realignment changed the fixed span',.001));
        t.assert(JSON.stringify(stored(photos[0].path).distributions)===range,'Realignment discarded the parallel fixed range');
        t.assert(host.querySelector(`input[aria-label="${rangeLabel}"]`),'Alignment did not enable distribution range');
        host.querySelector('#tab-template').click();await t.frame();button('更新原模板').click();await t.frame();
        host.querySelector('[aria-label="预览 line-b.jpg"]').click();await t.frame();
        [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click();await t.frame();await selectAll();
        ctx=await t.context(host);const onB=assertLine(ctx);button(label).click();await t.frame();
        positions(ctx).forEach((point,i)=>t.near(Math.hypot(point.x-onB[i].x,point.y-onB[i].y),0,'Repeating alignment on photo B moved saved layout',.001));
        root.unmount();root=createRoot(host);root.render(React.createElement(App));
        await t.waitFor(()=>host.querySelector('.design-canvas'),'Restored line editor missing');await selectAll();ctx=await t.context(host);assertLine(ctx);
        [...host.querySelectorAll('button')].find(item=>item.textContent.includes('导出当前')).click();
        await t.waitFor(()=>host.querySelector('[role="dialog"]'),'Line export dialog missing');
        [...host.querySelectorAll('[role="dialog"] button')].find(item=>item.textContent.includes('开始导出')).click();await t.waitFor(()=>exported,'Aligned document was not exported');
        const output=exported.items[0].document, outputGeometry=calculateGeometry(photos[1],output);
        const scene=positions(ctx);
        ids.forEach((id,i)=>{const point=layerPosition(output.layers.find(layer=>layer.id===id),outputGeometry);t.near(point.x,scene[i].x,'Export x differs from canvas',.001);t.near(point.y,scene[i].y,'Export y differs from canvas',.001);});
        reports.push({axis,selectionReference:true,parallelPositionsAndStylesPreserved:true,undoRedo:true,fixedRangePreserved:true,portraitTemplate:true,restart:true,exportMatchesCanvas:true});
      } finally {root.unmount();host.remove();clearMocks();}
    }
    // Eligibility belongs to the inspector: never silently align only a
    // subset, or normalize a coordinate against a collapsed region.
    const {LayerInspector}=await import('/src/LayerInspector.tsx');
    const design=structuredClone(builtInTemplates().find(item=>item.id==='wide-float').layouts.landscape);
    const base=design.layers[0];design.layers=[0,1].map(i=>({...base,id:`eligibility-${i}`,region:'bottom',visible:true}));
    design.frame.paddingY=5;design.regions.bottom.enabled=true;design.regions.bottom.extra=8;
    delete design.distributions;delete design.alignments;
    const host=document.createElement('div');host.style.cssText='position:fixed;right:0;top:0;height:100%;width:300px;z-index:2500';document.body.append(host);
    const root=createRoot(host),calls=[];
    const noop=()=>{};
    const render=async selected=>{
      root.render(React.createElement(LayerInspector,{document:structuredClone(design),photo:photos[0],selectedIds:selected,onSelect:noop,onSelectionChange:noop,onPatch:noop,onAdd:noop,onDelete:noop,onStart:noop,onEnd:noop,onOverride:noop,onArrange:(action,reference)=>calls.push({action,reference}),onRange:noop,onClearRange:noop}));await t.frame();
    };
    const button=text=>[...host.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
    try {
      const selected=design.layers.map(layer=>layer.id);
      await render(selected.slice(0,1));t.assert(!button('对齐成一行'),'Single selection exposes mutual alignment');
      await render(selected);t.assert(!button('对齐成一行').disabled&&!button('对齐成一列').disabled,'Two visible elements cannot align');
      button('对齐成一行').click();button('对齐成一列').click();
      t.assert(JSON.stringify(calls)===JSON.stringify([{action:'center-y',reference:'selection'},{action:'center-x',reference:'selection'}]),'Shortcut does not use selection centers');calls.length=0;
      design.layers[1].visible=false;await render(selected);
      t.assert(button('对齐成一行').disabled&&button('对齐成一列').disabled,'Hidden selection was only partially aligned');button('对齐成一行').click();t.assert(calls.length===0,'Disabled alignment emitted an edit');
      design.layers[1].visible=true;design.regions.bottom.enabled=false;await render(selected);
      t.assert(button('对齐成一行').disabled&&button('对齐成一列').disabled,'Disabled region can align');
      design.regions.bottom.enabled=true;design.regions.bottom.extra=0;design.frame.paddingY=0;await render(selected);
      t.assert(button('对齐成一行').disabled&&!button('对齐成一列').disabled,'Collapsed height did not independently guard the row operation');
      t.assert(host.scrollWidth<=host.clientWidth+1,'Line alignment overflows a narrow inspector');
    }finally{root.unmount();host.remove();}
    return {scenarios:reports,eligibilityAndNarrowInspector:true};
  } finally {saved.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));}
})();
