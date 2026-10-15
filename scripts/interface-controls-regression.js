// Exercise the shared combobox inside the real app, including modal/window boundaries.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const {mockIPC,mockWindows,clearMocks} = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const {default:React} = await import(moduleUrl('react'));
  const {default:{createRoot}} = await import(moduleUrl('react-dom_client'));
  const {createDefaultDocument} = await import('/src/editor-model.ts');
  const {SelectControl} = await import('/src/SelectControl.tsx');
  const {themePreferenceKey, parseThemePreference, saveThemePreference} = await import('/src/theme.ts');
  const savedTheme = localStorage.getItem(themePreferenceKey);
  const key='yingkuang-session-v2', saved=localStorage.getItem(key), calls=[];
  let maximized=false, resolvePreflight;
  localStorage.setItem(key,JSON.stringify({paths:['ui.jpg'],activePath:'ui.jpg',checkedPaths:['ui.jpg'],documentsByPath:{'ui.jpg':createDefaultDocument()},exportSettings:{directory:'/output',range:'current'}}));
  mockIPC((command,args)=>{
    if(command==='plugin:dialog|open') {calls.push({command,args});return null;}
    if(command.startsWith('plugin:window|')) {
      calls.push({command,args});
      if(command==='plugin:window|is_maximized') return maximized;
      if(command==='plugin:window|toggle_maximize') maximized=!maximized;
      return;
    }
    if(command==='inspect_images_resilient') return {items:[{id:'ui',path:'ui.jpg',fileName:'ui.jpg',width:6000,height:4000,megapixels:24,thumbnailDataUrl:'/demo.jpg',metadata:{}}],failures:[]};
    if(command==='preflight_export') return new Promise(resolve=>{resolvePreflight=resolve;});
  },{shouldMockEvents:true});
  mockWindows('main');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:1000';document.body.append(host);
  const root=createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
  const combo=label=>host.querySelector(`button[role="combobox"][aria-label="${label}"]`);
  const keypress=async (target,key)=>{target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await t.frame();};
  const nativeValue=label=>combo(label).parentElement.querySelector('select').value;
  const assertAligned=()=>{for(const grid of host.querySelectorAll('.export-grid')) {
    const controls=[...grid.querySelectorAll('.select-trigger,input')];
    t.near(controls[0].getBoundingClientRect().top,controls[1].getBoundingClientRect().top,'Export control tops differ',.5);
    t.near(controls[0].getBoundingClientRect().height,controls[1].getBoundingClientRect().height,'Export control heights differ',.5);
  }};
  try {
    const {default:App}=await import(`/src/App.tsx?interface-regression=${Date.now()}`);
    root.render(React.createElement(React.StrictMode,null,React.createElement(App)));
    await t.waitFor(()=>host.querySelector('.photo-row')&&host.querySelector('.design-canvas'),'App did not restore');
    t.near(host.querySelector('.app-header').getBoundingClientRect().height,48,'Header height');
    t.assert(host.querySelector('.theme-control').getBoundingClientRect().right <= host.querySelector('.window-controls').getBoundingClientRect().left, 'Theme control overlaps native window buttons');
    // Real pointer input includes mousedown: click() alone missed the titlebar bug.
    const themeButton = host.querySelector('button.theme-control');
    const initialTheme = document.documentElement.dataset.themePreference;
    const nextTheme = { system: 'light', light: 'dark', dark: 'system' };
    let expectedTheme = initialTheme;
    const dragCount = calls.filter(x => x.command === 'plugin:window|start_dragging').length;
    for (let i = 0; i < 3; i++) {
      themeButton.querySelector('svg').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
      themeButton.click(); await t.frame(); expectedTheme = nextTheme[expectedTheme];
      t.assert(document.documentElement.dataset.themePreference === expectedTheme, 'Theme icon failed to cycle');
    }
    t.assert(calls.filter(x => x.command === 'plugin:window|start_dragging').length === dragCount, 'Theme icon starts native window dragging');
    // Retain coverage of the original failure: a shared popup mounted in the header.
    const pickerHost = document.createElement('span'); host.querySelector('.header-actions').append(pickerHost);
    const pickerRoot = createRoot(pickerHost); let picked;
    try {
      pickerRoot.render(React.createElement(SelectControl, { value: 'light', 'aria-label': '标题栏测试选项', onChange: e => { picked = e.currentTarget.value; } },
        React.createElement('option', { value: 'light' }, '浅色'), React.createElement('option', { value: 'dark' }, '深色')));
      await t.frame(); pickerHost.querySelector('button').click(); await t.frame();
      const option = pickerHost.querySelector('[role="option"][data-index="1"]');
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
      await t.frame();
      t.assert(calls.filter(x => x.command === 'plugin:window|start_dragging').length === dragCount, 'Header menu starts native window dragging instead of selecting');
      option.click(); await t.frame(); t.assert(picked === 'dark', 'Header menu selection was blocked');
    } finally { pickerRoot.unmount(); pickerHost.remove(); }
    t.assert(![...host.querySelectorAll('.canvas-toolbar button')].some(x=>x.textContent.trim()==='编辑'),'Dead edit button remains');
    button('添加照片').click();await t.frame();
    const extensions=calls.find(x=>x.command==='plugin:dialog|open').args.options.filters[0].extensions;
    t.assert(extensions.includes('JPG')&&extensions.includes('jPeG')&&extensions.includes('pNg'),'Native photo chooser hides valid case variants');
    const header=host.querySelector('.brand-block');
    header.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,detail:1}));await t.frame();
    t.assert(calls.some(x=>x.command==='plugin:window|start_dragging'),'Header drag did not invoke native action');
    header.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,detail:2}));await t.frame();
    t.assert(maximized,'Header double click did not maximize');
    host.querySelector('[aria-label="还原窗口"]').click();await t.frame();
    t.assert(!maximized,'Restore action missing');
    t.assert(host.querySelectorAll('.window-resize').length===8,'Resize handles missing');
    host.querySelector('.window-resize-SouthEast').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));await t.frame();
    t.assert(calls.some(x=>x.command==='plugin:window|start_resize_dragging'&&x.args.value==='SouthEast'),'Corner resize missing');
    host.querySelector('#tab-watermark').click();await t.frame();host.querySelector('.layer-main').click();await t.frame();
    const ctx=await t.context(host), layers=ctx.world.find('.watermark-layer');
    const positions=layers.map(x=>({x:x.x(),y:x.y()}));
    combo('所属区域').focus();await keypress(combo('所属区域'),'ArrowRight');await keypress(combo('所属区域'),'Delete');
    t.assert(ctx.world.find('.watermark-layer').length===layers.length,'Combobox key deleted a watermark');
    layers.forEach((layer,index)=>{t.near(layer.x(),positions[index].x,'Combobox moved watermark X');t.near(layer.y(),positions[index].y,'Combobox moved watermark Y');});
    button('导出当前').click();await t.frame();assertAligned();
    const chrome=host.querySelector('[data-window-chrome]');
    t.assert(!chrome.inert&&!chrome.closest('[inert]'),'Modal disabled native window controls');
    host.querySelector('[aria-label="最小化窗口"]').click();await t.frame();
    t.assert(calls.some(x=>x.command==='plugin:window|minimize'),'Modal prevented minimize');
    combo('格式').focus();await keypress(combo('格式'),'Enter');
    await keypress(combo('格式'),'End');await keypress(combo('格式'),'Enter');
    t.assert(nativeValue('格式')==='png'&&!host.querySelector('.select-menu'),'Keyboard selection did not commit and dismiss');
    t.assert(document.activeElement===combo('格式'),'Selection lost focus');assertAligned();
    combo('格式').click();await t.frame();await keypress(combo('格式'),'Home');await keypress(combo('格式'),'Escape');
    t.assert(nativeValue('格式')==='png'&&host.querySelector('.export-dialog')&&!host.querySelector('.select-menu'),'Escape changed value or closed export');
    combo('格式').click();await t.frame();host.querySelector('.select-menu [data-index="0"]').click();await t.frame();
    t.assert(nativeValue('格式')==='jpeg'&&!host.querySelector('.select-menu'),'Mouse option did not commit and dismiss');
    combo('格式').click();await t.frame();
    host.querySelector('.select-menu [data-index="1"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));await t.frame();
    t.assert(nativeValue('格式')==='png'&&!host.querySelector('.select-menu'),'Pointer release did not commit the native menu option');
    combo('格式').click();await t.frame();host.querySelector('.select-menu [data-index="0"]').click();await t.frame();
    combo('成品尺寸').focus();await keypress(combo('成品尺寸'),'ArrowDown');await keypress(combo('成品尺寸'),'End');await keypress(combo('成品尺寸'),'Enter');
    t.assert(nativeValue('成品尺寸')==='long-edge'&&host.querySelector('.export-dialog input[type="number"]'),'Size selection did not reveal long edge');assertAligned();
    const suffix=[...host.querySelectorAll('label')].find(x=>x.textContent.startsWith('文件名后缀')).querySelector('input');
    t.change(suffix,'/');await t.frame();assertAligned();
    t.assert(suffix.closest('.field').classList.contains('field-error'),'Invalid suffix not shown');
    t.change(suffix,'-相框');await t.frame();
    combo('元数据').scrollIntoView({block:'center'});await t.frame();combo('元数据').click();await t.frame();
    const menu=host.querySelector('.select-menu'),rect=menu.getBoundingClientRect();
    t.assert(rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth,'Menu escaped the viewport');
    await keypress(combo('元数据'),'Home');await keypress(combo('元数据'),'Enter');
    t.assert([...host.querySelectorAll('.check-field')].find(x=>x.textContent.includes('保留 GPS')).querySelector('input').disabled,'No metadata did not disable GPS');
    combo('元数据').click();await t.frame();await keypress(combo('元数据'),'Tab');
    t.assert(!host.querySelector('.select-menu'),'Tab did not dismiss');
    combo('元数据').click();await t.frame();suffix.focus();await t.frame();
    t.assert(!host.querySelector('.select-menu'),'External focus did not dismiss');
    const scrollBody=host.querySelector('.export-body');
    // Guarantee a scrollable fixture; font metrics and native viewport sizes vary.
    scrollBody.style.maxHeight='240px';
    combo('格式').scrollIntoView({block:'center'});await t.frame();combo('格式').click();await t.frame();
    t.assert(host.querySelector('.select-menu'),'Scrolling fixture menu did not open');
    const beforeScroll=scrollBody.scrollTop, maxScroll=scrollBody.scrollHeight-scrollBody.clientHeight;
    t.assert(maxScroll>0,'Scrolling fixture does not overflow');
    scrollBody.scrollTop=beforeScroll<maxScroll?Math.min(maxScroll,beforeScroll+10):Math.max(0,beforeScroll-10);
    t.assert(scrollBody.scrollTop!==beforeScroll,'Scrolling fixture did not move');
    await t.waitFor(()=>!host.querySelector('.select-menu'),'Scrolling left a detached menu');
    button('预检并开始导出').click();await t.waitFor(()=>resolvePreflight,'Preflight missing');
    t.assert(combo('格式').matches(':disabled'),'Busy fieldset left combobox enabled');
    combo('格式').click();await t.frame();t.assert(!host.querySelector('.select-menu'),'Disabled combobox opened');
    resolvePreflight({ready:false,total:1,warnings:[],errors:['测试预检失败']});await t.frame();
    button('取消').click();await t.frame();t.assert(!host.querySelector('.export-dialog'),'Cancel failed');
    host.querySelector('[aria-label="关闭窗口"]').click();await t.frame();
    t.assert(calls.some(x=>x.command==='plugin:window|close'),'Close action missing');
    return {alignedExportFields:true,compactHeader:true,noDeadEditButton:true,keyboardAndMouseSelection:true,pointerReleaseCommits:true,escapeKeepsModal:true,viewportMenu:true,disabledFieldset:true,windowControlsDuringModal:true,dragResizeAndClose:true,comboboxGuardsCanvas:true,caseInsensitivePhotoFilter:true};
  } finally {
    root.unmount();host.remove();clearMocks();
    saveThemePreference(parseThemePreference(savedTheme));
    if (savedTheme === null) localStorage.removeItem(themePreferenceKey);
    window.dispatchEvent(new StorageEvent('storage', { key: themePreferenceKey, newValue: savedTheme }));
    if(saved===null)localStorage.removeItem(key);else localStorage.setItem(key,saved);
  }
})();
