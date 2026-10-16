// Drive percentages, sliders, undo and cross-photo template application in WebKit.
(async()=>{
  const t=await import('/scripts/konva-test-utils.js');
  const {mockIPC,clearMocks}=await import('/node_modules/@tauri-apps/api/mocks.js');
  const url=name=>performance.getEntriesByType('resource').find(e=>e.name.includes(`/deps/${name}.js?`)).name;
  const {default:React}=await import(url('react'));
  const {default:{createRoot}}=await import(url('react-dom_client'));
  const {builtInTemplates}=await import('/src/builtin-template-catalog.ts');
  const {ensureFontsLoaded}=await import('/src/font-library.ts');
  const keys=['yingkuang-session-v2','yingkuang-templates-v3','yingkuang-default-template-v1'];
  const saved=keys.map(key=>[key,localStorage.getItem(key)]),reports=[];
  try {for(const axis of ['x','y']) {
    const template=structuredClone(builtInTemplates().find(item=>item.id==='wide-float'));
    template.id='range-fixture';template.name='分布范围回归';template.builtIn=false;
    const original=template.layouts.landscape.layers.find(layer=>layer.source==='focalLength');
    template.layouts.landscape.layers=['focalLength','aperture','iso'].map((source,i)=>({...original,id:`range-${i}`,name:`范围${i}`,source,region:'canvas',x:axis==='x'?.2+i*.3:.5,y:axis==='y'?.2+i*.3:.5,rotation:axis==='y'?90:0,visible:true}));
    delete template.layouts.landscape.distributions;delete template.layouts.landscape.alignments;
    localStorage.setItem(keys[0],JSON.stringify({paths:['range-a.jpg','range-b.jpg'],activePath:'range-a.jpg',exportSettings:{directory:'/tmp',range:'current'}}));
    localStorage.setItem(keys[1],JSON.stringify({version:2,overrides:[],custom:[template]}));localStorage.setItem(keys[2],template.id);
    let exported;
    mockIPC((command,args)=>{if(command==='inspect_images_resilient')return {items:[
      {id:'range-a',path:'range-a.jpg',fileName:'range-a.jpg',width:600,height:400,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'50mm',aperture:'f/2',iso:'ISO100'}},
      {id:'range-b',path:'range-b.jpg',fileName:'range-b.jpg',width:800,height:400,megapixels:.32,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'135mm',aperture:'f/11',iso:'ISO12800'}},
    ].filter(item=>!args?.paths || args.paths.includes(item.path)),failures:[]};
      if(command==='preflight_export')return {ready:true,total:1,estimatedPixels:1200000,largestWidth:1200,largestHeight:900,largestFileName:'range-b.jpg',errors:[],warnings:[]};
      if(command==='export_images'){exported=args.request;return {total:1,succeeded:1,failed:0,skipped:0,cancelled:false,outputDirectory:'/tmp',failures:[],warnings:[]};}
    },{shouldMockEvents:true});
    const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:2500';document.body.append(host);
    const root=createRoot(host),label=axis==='x'?'占用宽度':'占用高度',distribute=axis==='x'?'横向等间距':'纵向等间距',center=axis==='x'?'水平居中':'垂直居中';
    const button=text=>[...host.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
    const input=()=>host.querySelector(`input[aria-label="${label}百分比"]`),slider=()=>host.querySelector(`input[aria-label="${label}"]`);
    const doc=path=>JSON.parse(localStorage.getItem(keys[0])).documentsByPath[path];
    const range=path=>doc(path).distributions?.find(rule=>rule.axis===axis)?.range;
    const select=async(count=3)=>{host.querySelector('#tab-watermark').click();await t.frame();for(let i=0;i<count;i++)host.querySelector(`[aria-label="选择图层 范围${i}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));await t.frame();};
    const setNumber=async(value,key='Enter')=>{input().focus();t.change(input(),value);await t.frame();input().dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));await t.frame();};
    const checkSpan=async(ratio,count=3)=>{
      const ctx=await t.context(host),dimension=axis==='x'?'width':'height';
      const boxes=Array.from({length:count},(_,i)=>ctx.world.findOne(node=>node.id()===`range-${i}`).findOne('Text').getClientRect({relativeTo:ctx.world})).sort((a,b)=>a[axis]-b[axis]);
      const span=boxes.at(-1)[axis]+boxes.at(-1)[dimension]-boxes[0][axis],reference=axis==='x'?ctx.world.clipWidth():ctx.world.clipHeight();
      t.near(span/reference,ratio,'Group span does not match requested percentage',.000001);
      const gaps=boxes.slice(1).map((box,i)=>box[axis]-boxes[i][axis]-boxes[i][dimension]);
      gaps.forEach(gap=>{t.near(gap,gaps[0],'Edge gaps are unequal',.001);t.assert(gap>=-.001,'Elements overlap');});
      return ctx;
    };
    try {
      await ensureFontsLoaded(template.layouts.landscape.layers.map(layer=>layer.fontFamily));
      const {default:App}=await import(`/src/App.tsx?distribution-range=${Date.now()}`);root.render(React.createElement(App));
      await t.waitFor(()=>host.querySelector('.konvajs-content')&&host.querySelector('.template-card-copy strong'),'Editor not ready');
      [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click();await t.frame();await select();
      button(center).click();await t.frame();
      await setNumber(60);await checkSpan(.6);t.near(range('range-a.jpg').ratio,.6,'Numeric input did not save target',1e-9);
      await setNumber(60.04);t.near(Number(input().value),60,'Percentage precision is inconsistent',1e-9);await checkSpan(.6);
      t.assert(doc('range-a.jpg').layers.every(layer=>layer.fontSize===original.fontSize && layer.rotation===(axis==='y'?90:0)),'Range changed typography');
      await setNumber(1);t.near(Number(input().value),60,'Invalid percentage did not restore field',1e-9);await checkSpan(.6);
      await setNumber(70,'Escape');await checkSpan(.6);
      const initialContext=await t.context(host),backdrop=initialContext.stage.findOne('.preview-backdrop')?.image();
      slider().dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      for(const value of [45,55,50]){t.change(slider(),value);await t.frame();}
      slider().dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await t.frame();await checkSpan(.5);
      if(backdrop)t.assert(initialContext.stage.findOne('.preview-backdrop').image()===backdrop,'Range slider rebuilt photo/background pixels');
      host.querySelector('[aria-label="撤销"]').click();await t.frame();await checkSpan(.6);
      host.querySelector('[aria-label="重做"]').click();await t.frame();await checkSpan(.5);
      host.querySelector('#tab-template').click();await t.frame();button('更新原模板').click();await t.frame();
      host.querySelector('[aria-label="预览 range-b.jpg"]').click();await t.frame();
      [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click();await t.frame();await select();
      const ctx=await checkSpan(.5),before=[0,1,2].map(i=>ctx.world.findOne(node=>node.id()===`range-${i}`).position());
      button(distribute).click();await t.frame();button(center).click();await t.frame();await checkSpan(.5);
      before.forEach((point,i)=>{const next=ctx.world.findOne(node=>node.id()===`range-${i}`).position();t.near(next.x,point.x,'Repeated arrange moved x',.01);t.near(next.y,point.y,'Repeated arrange moved y',.01);});
      t.near(range('range-b.jpg').ratio,.5,'Repeated distribution discarded fixed range',1e-9);
      host.querySelector('[aria-label="解除固定范围"]').click();await t.frame();await checkSpan(.5);t.assert(!range('range-b.jpg'),'Reset left a fixed range');
      await setNumber(60);await checkSpan(.6);
      await select(2);await setNumber(65);await checkSpan(.65,2);
      t.assert(doc('range-b.jpg').distributions.find(rule=>rule.axis===axis).layerIds.length===2,'Two-element range was not saved');
      t.assert(range('range-b.jpg').reference==='canvas','New range must use a single canvas basis');
      await t.disableSnap(ctx);
      const node=ctx.world.findOne(item=>item.id()==='range-0'),start=t.screen(ctx,node),points=[0,1].map(i=>ctx.world.findOne(item=>item.id()===`range-${i}`).position()),scale=ctx.world.scaleX();
      t.mouse(ctx.content,'mousedown',start);t.mouse(window,'mousemove',{x:start.x+8,y:start.y+4});await t.frame();t.mouse(window,'mousemove',{x:start.x+20,y:start.y+10});await t.frame();t.mouse(window,'mouseup',{x:start.x+20,y:start.y+10},0);await t.frame();
      points.forEach((point,i)=>{const next=ctx.world.findOne(item=>item.id()===`range-${i}`).position();t.near(next.x-point.x,20/scale,'Dragging ranged group changed x delta',.01);t.near(next.y-point.y,10/scale,'Dragging ranged group changed y delta',.01);});
      t.near(range('range-b.jpg').ratio,.65,'Dragging lost fixed range',1e-9);
      const expected=doc('range-b.jpg');button('导出当前').click();
      await t.waitFor(()=>host.querySelector('.export-dialog'),'Export dialog missing');
      [...host.querySelectorAll('.export-dialog button')].find(item=>item.textContent.includes('开始导出')).click();
      await t.waitFor(()=>exported,'Export did not receive document');
      const output=exported.items[0].document;
      t.near(output.distributions.find(rule=>rule.axis===axis).range.ratio,.65,'Export lost fixed span',1e-9);
      expected.layers.forEach(layer=>{const actual=output.layers.find(item=>item.id===layer.id);t.near(actual.x,layer.x,'Export x differs from preview',1e-9);t.near(actual.y,layer.y,'Export y differs from preview',1e-9);});
      reports.push({axis,percentageInput:true,sliderUndo:true,crossPhotoTemplate:true,repeatStable:true,twoElements:true,canvasBasisAndReset:true,groupDrag:true,exportSnapshot:true});
    } finally {root.unmount();host.remove();clearMocks();}
  }return {scenarios:reports};} finally {saved.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));}
})();
