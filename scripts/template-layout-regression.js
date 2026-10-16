// Exercise saved distribution and orientation changes through the real editor.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const url = name => performance.getEntriesByType('resource').find(e => e.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(url('react'));
  const { default: { createRoot } } = await import(url('react-dom_client'));
  const { builtInTemplates } = await import('/src/builtin-template-catalog.ts');
  const keys = ['yingkuang-session-v2', 'yingkuang-templates-v3', 'yingkuang-default-template-v1'];
  const saved = keys.map(key => [key, localStorage.getItem(key)]);
  const template = structuredClone(builtInTemplates().find(t => t.id === 'wide-float'));
  template.id = 'layout-fixture'; template.name = '布局回归'; template.builtIn = false;
  const original = template.layouts.landscape.layers.find(l => l.source === 'focalLength');
  template.layouts.landscape.layers = ['focalLength','aperture','iso'].map((source,i) => ({...original,id:`fixture-${i}`,name:`测试${i}`,source,x:.2+i*.3,y:.5,visible:true,fontFamily:'Space Mono',fontSize:24}));
  delete template.layouts.landscape.distributions;
  delete template.layouts.landscape.alignments;
  template.layouts.landscape.frame.color = '#123456';
  template.layouts.portrait = structuredClone(template.layouts.landscape);
  template.layouts.portrait.frame.color = '#654321';
  localStorage.setItem(keys[0],JSON.stringify({paths:['layout-a.jpg','layout-b.jpg'],activePath:'layout-a.jpg'}));
  localStorage.setItem(keys[1],JSON.stringify({version:2,overrides:[],custom:[template]}));
  localStorage.setItem(keys[2],template.id);
  mockIPC(command => command === 'inspect_images_resilient' ? {items:[
    {id:'layout-a',path:'layout-a.jpg',fileName:'layout-a.jpg',width:600,height:400,megapixels:.24,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'50mm',aperture:'f/2',iso:'ISO100'}},
    {id:'layout-b',path:'layout-b.jpg',fileName:'layout-b.jpg',width:800,height:400,megapixels:.32,thumbnailDataUrl:'/demo.jpg',metadata:{focalLength:'135mm',aperture:'f/11',iso:'ISO12800'}},
  ],failures:[]} : undefined,{shouldMockEvents:true});
  const host = document.createElement('div'); host.style.cssText='position:fixed;inset:0;z-index:2500'; document.body.append(host);
  const root=createRoot(host), failures=[];
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim()===text);
  const selectAll = async () => {
    host.querySelector('#tab-watermark').click(); await t.frame();
    for(let i=0;i<3;i++) host.querySelector(`[aria-label="选择图层 测试${i}"]`).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:i>0}));
    await t.frame();
  };
  try {
    const {default:App}=await import(`/src/App.tsx?template-layout=${Date.now()}`);
    root.render(React.createElement(App));
    await t.waitFor(()=>host.querySelector('.template-card-copy strong') && host.querySelector('.konvajs-content'),'Editor not ready');
    [...host.querySelectorAll('.template-card')].find(b=>b.textContent.includes(template.name)).click(); await t.frame();
    await selectAll(); button('横向等间距').click(); await t.frame();
    host.querySelector('#tab-template').click(); await t.frame(); button('更新原模板').click(); await t.frame();
    host.querySelector('[aria-label="预览 layout-b.jpg"]').click(); await t.frame();
    [...host.querySelectorAll('.template-card')].find(b=>b.textContent.includes(template.name)).click(); await t.frame();
    await selectAll();
    const ctx=await t.context(host);
    const positions=()=>[0,1,2].map(i=>ctx.world.findOne(n=>n.id()===`fixture-${i}`).x());
    const before=positions(); button('横向等间距').click(); await t.frame();
    const after=positions();
    if(after.some((x,i)=>Math.abs(x-before[i])>.01)) failures.push(`Saved equal gaps change on a new photo: ${JSON.stringify({before,after})}`);
    button('裁切与旋转').click();
    await t.waitFor(()=>host.querySelector('[aria-label="向右旋转90度"]'),'Crop dialog missing');
    host.querySelector('[aria-label="向右旋转90度"]').click(); await t.frame(); button('应用调整').click(); await t.frame();
    const session=JSON.parse(localStorage.getItem(keys[0]));
    const color=session.documentsByPath['layout-b.jpg'].frame.color;
    if(color!==template.layouts.portrait.frame.color) failures.push(`Rotation keeps landscape template until another click: ${color}`);
    t.assert(!failures.length,failures.join('\n'));
    return {savedDistributionResponsive:true,rotationSelectsPortrait:true};
  } finally {
    root.unmount();host.remove();clearMocks();
    saved.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));
  }
})();
