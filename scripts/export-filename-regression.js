// A native filename preflight failure must be actionable without starting an export.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  const requests = [];
  let preflights=0;
  localStorage.setItem(key, JSON.stringify({
    paths: ['retry-first.jpg', 'retry-second.jpg'], activePath: 'retry-first.jpg', checkedPaths: ['retry-first.jpg'],
    documentsByPath: { 'retry-first.jpg': createDefaultDocument(), 'retry-second.jpg': createDefaultDocument() },
    exportSettings: { directory: '/original-output', range: 'current' },
  }));
  mockIPC((command, args) => {
    if (command === 'inspect_images_resilient') return {
      items: args.paths.map(path => ({ id: path, path, fileName: path, width: 6000, height: 4000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} })), failures: [],
    };
    if (command === 'preflight_export') {
      preflights++;
      const ready=args.request.settings.suffix==='';
      return {ready,total:1,warnings:[],errors:ready?[]:Array.from({length:20},(_,index)=>`/photos/source-${index}/${'a'.repeat(249)}.png：输出文件名或路径过长或无效，请缩短原文件名、后缀或输出目录路径`)};
    }
    if (command === 'export_images') {
      requests.push(structuredClone(args.request));
      return {total:1,succeeded:1,failed:0,skipped:0,cancelled:false,outputDirectory:args.request.settings.directory,warnings:[],failures:[]};
    }
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  try {
    const { default: App } = await import(`/src/App.tsx?filename-preflight=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2, 'Photos were not restored');
    button('导出当前').click();
    await t.waitFor(() => host.querySelector('.export-dialog'), 'Export settings missing');
    button('预检并开始导出').click();
    await t.waitFor(() => host.querySelector('.export-dialog')?.textContent.includes('请缩短'), 'Filename error is not shown');
    const dialog=host.querySelector('.export-dialog');
    t.assert(dialog.getBoundingClientRect().width<=innerWidth && dialog.scrollWidth<=dialog.clientWidth+1,'Long filename widens the export dialog beyond the viewport');
    const issues=host.querySelector('.export-issues');
    t.assert(issues.getBoundingClientRect().right<=host.querySelector('.export-body').getBoundingClientRect().right,'Filename error is clipped outside the visible summary');
    t.assert(issues.scrollWidth<=issues.clientWidth+1,'Long filename overflows the preflight error panel');
    t.assert(issues.querySelectorAll('small').length===20,'Preflight lost a same-name source error');
    t.assert(issues.textContent.includes('/source-0/')&&issues.textContent.includes('/source-19/'),'Same-name sources are not distinguishable');
    const body=host.querySelector('.export-body');
    body.scrollTop=body.scrollHeight;await t.frame();
    const last=issues.querySelector('small:last-child').getBoundingClientRect();
    t.assert(last.bottom<=body.getBoundingClientRect().bottom+1&&last.bottom>body.getBoundingClientRect().top,'Last preflight error cannot be reached by scrolling');
    const footer=host.querySelector('.export-dialog-footer').getBoundingClientRect();
    t.assert(footer.bottom<=innerHeight-23&&footer.top>=0,'Long preflight errors displaced the action footer');
    button('返回修改设置').click();await t.frame();
    t.assert(body.scrollTop===0&&document.activeElement.classList.contains('directory-picker'),'Return to settings did not restore the top and keyboard focus');
    t.assert(requests.length===0 && !host.querySelector('.progress-dialog'),'Failed preflight started image processing');
    const suffix=[...host.querySelectorAll('.export-dialog label')].find(label=>label.textContent.includes('文件名后缀')).querySelector('input');
    suffix.scrollIntoView({block:'center'});await t.frame();
    t.change(suffix,'');await t.frame();
    t.assert(!button('预检并开始导出').disabled,'Correcting suffix does not enable retry');
    button('预检并开始导出').click();
    await t.waitFor(()=>host.querySelector('.result-dialog'),'Corrected settings did not export');
    t.assert(preflights===2 && requests.length===1 && requests[0].settings.suffix==='','Corrected request was not rechecked');
    return {filenameErrorVisible:true,noExportBeforePreflight:true,correctedSuffixRetried:true,preflights,distinctSourceErrors:20,lastErrorReachable:true,footerVisible:true,returnToSettings:true};
  } finally {
    root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
