// Save arrangement on photo A, apply on photo B, and repeat the same actions.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const url = name => performance.getEntriesByType('resource').find(e => e.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(url('react'));
  const { default: { createRoot } } = await import(url('react-dom_client'));
  const { builtInTemplates } = await import('/src/builtin-template-catalog.ts');
  const { ensureFontsLoaded } = await import('/src/font-library.ts');
  const keys = ['yingkuang-session-v2', 'yingkuang-templates-v3', 'yingkuang-default-template-v1'];
  const saved = keys.map(key => [key, localStorage.getItem(key)]);
  const reports=[];
  try {
  for (const scenario of [
    {axis:'x',rotation:0,centerFirst:false,fontFamily:'Cinzel, Long Cang, sans-serif'},
    {axis:'y',rotation:90,centerFirst:false,fontFamily:'Cormorant Garamond'},
    {axis:'x',rotation:0,centerFirst:true,fontFamily:'Space Mono'},
    {axis:'x',rotation:0,centerOnly:true,fontFamily:'Cinzel, Long Cang, sans-serif'},
  ]) {
  const template = structuredClone(builtInTemplates().find(item => item.id === 'wide-float'));
  template.id = 'arrangement-fixture'; template.name = '跨照片排版回归'; template.builtIn = false;
  const original = template.layouts.landscape.layers.find(layer => layer.source === 'focalLength');
  template.layouts.landscape.layers = ['focalLength', 'aperture', 'iso'].map((source, i) => ({
    ...original, id:`arrangement-${i}`, name:`排版${i}`, source, visible:true,
    x:scenario.axis==='x'?.2+i*.3:.5,y:scenario.axis==='y'?.2+i*.3:.5,
    rotation:scenario.rotation,fontFamily:scenario.fontFamily,
  }));
  delete template.layouts.landscape.distributions;
  delete template.layouts.landscape.alignments;
  localStorage.setItem(keys[0], JSON.stringify({paths:['arrangement-a.jpg','arrangement-b.jpg'], activePath:'arrangement-a.jpg'}));
  localStorage.setItem(keys[1], JSON.stringify({version:2, overrides:[], custom:[template]}));
  localStorage.setItem(keys[2], template.id);
  mockIPC(command => command === 'inspect_images_resilient' ? {items:[
    {id:'arrangement-a',path:'arrangement-a.jpg',fileName:'arrangement-a.jpg',width:600,height:400,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'50mm',aperture:'f/2',iso:'ISO100'}},
    {id:'arrangement-b',path:'arrangement-b.jpg',fileName:'arrangement-b.jpg',width:800,height:400,megapixels:.32,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'135mm',aperture:'f/11',iso:'ISO12800'}},
  ],failures:[]} : undefined, {shouldMockEvents:true});
  const host=document.createElement('div'); host.style.cssText='position:fixed;inset:0;z-index:2500'; document.body.append(host);
  const root=createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
  const selectAll=async()=>{
    host.querySelector('#tab-watermark').click(); await t.frame();
    for(let i=0;i<3;i++) host.querySelector(`[aria-label="选择图层 排版${i}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));
    await t.frame();
  };
  const distribute=scenario.axis==='x'?'横向等间距':'纵向等间距';
  const center=scenario.axis==='x'?'水平居中':'垂直居中';
  const actions=scenario.centerOnly?[center]:scenario.centerFirst?[center,distribute]:[distribute,center];
  try {
    await ensureFontsLoaded(template.layouts.landscape.layers.map(layer=>layer.fontFamily));
    const {default:App}=await import(`/src/App.tsx?arrangement-persistence=${Date.now()}`);
    root.render(React.createElement(App));
    await t.waitFor(()=>host.querySelector('.template-card-copy strong') && host.querySelector('.konvajs-content'),'Editor not ready');
    [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click(); await t.frame();
    await selectAll();
    for(const action of actions) {button(action).click(); await t.frame();}
    const savedDocument=JSON.parse(localStorage.getItem(keys[0])).documentsByPath['arrangement-a.jpg'];
    t.assert(savedDocument.alignments?.length===1,'Alignment rule was not saved');
    if(!scenario.centerOnly) t.assert(savedDocument.distributions?.length===1,'Centering discarded the distribution rule');
    host.querySelector('[aria-label="撤销"]').click(); await t.frame();
    host.querySelector('[aria-label="重做"]').click(); await t.frame();
    const redone=JSON.parse(localStorage.getItem(keys[0])).documentsByPath['arrangement-a.jpg'];
    t.assert(JSON.stringify(redone.alignments)===JSON.stringify(savedDocument.alignments) && JSON.stringify(redone.distributions)===JSON.stringify(savedDocument.distributions),'Undo/redo lost layout rules');
    host.querySelector('#tab-template').click(); await t.frame(); button('更新原模板').click(); await t.frame();
    host.querySelector('[aria-label="预览 arrangement-b.jpg"]').click(); await t.frame();
    [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click(); await t.frame();
    await selectAll();
    const failures=[];
    const check=async photo=>{
    const ctx=await t.context(host);
    const positions=()=>[0,1,2].map(i=>ctx.world.findOne(node=>node.id()===`arrangement-${i}`).position());
    for(const action of actions) {
      const before=positions(); button(action).click(); await t.frame(); const after=positions();
      const drift=Math.max(...after.map((point,i)=>Math.hypot(point.x-before[i].x,point.y-before[i].y)));
      if(drift>.01) failures.push(`${action} moves saved template on photo ${photo} by ${drift}px: ${JSON.stringify({scenario,before,after})}`);
    }
    };
    await check('B');
    host.querySelector('#tab-template').click(); await t.frame(); button('更新原模板').click(); await t.frame();
    host.querySelector('[aria-label="预览 arrangement-a.jpg"]').click(); await t.frame();
    [...host.querySelectorAll('.template-card')].find(item=>item.textContent.includes(template.name)).click(); await t.frame();
    await selectAll(); await check('A again');
    t.assert(!failures.length,failures.join('\n'));
    reports.push({...scenario,crossPhotoArrangement:true,undoRedo:true,saveBackToA:true});
  } finally {
    root.unmount(); host.remove(); clearMocks();
  }
  }
  return {scenarios:reports};
  } finally {saved.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));}
})();
