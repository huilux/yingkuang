// Exercise session restoration through the real App and Tauri's IPC mock.
(async () => {
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const saved = localStorage.getItem('yingkuang-session-v2');
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const missingDocument = createDefaultDocument();
  missingDocument.frame.paddingX = 17;
  const session = {
    paths: ['first.jpg', 'missing.jpg', 'active.jpg'], activePath: 'active.jpg',
    checkedPaths: ['first.jpg'], documentsByPath: { 'missing.jpg': missingDocument }, overridesByPath: { 'active.jpg': { camera: 'Restored Camera' }, 'missing.jpg': { camera: 'Missing Camera' } },
    cropsByPath: { 'missing.jpg': { x: .1, y: .2, width: .5, height: .5, rotation: 13.7 } },
  };
  localStorage.setItem('yingkuang-session-v2', JSON.stringify(session));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const inspections = [];
  let missingAvailable = false;
  mockIPC(async (command, args) => {
    if (command === 'plugin:dialog|open') return ['missing.jpg'];
    if (command !== 'inspect_images_resilient') return;
    inspections.push(...args.paths);
    if (args.paths.includes('first.jpg')) await gate;
    return {
      items: args.paths.filter(path => (path !== 'missing.jpg' || missingAvailable)).map(path => ({ id: path, path, fileName: path, width: 6000, height: 4000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} })),
      failures: args.paths.filter(path => path === 'missing.jpg' && !missingAvailable).map(path => ({ path, reason: 'missing' })),
    };
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { default: App } = await import(`/src/App.tsx?restore-regression=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    const started = performance.now();
    while (!host.querySelector('.design-canvas') && performance.now() - started < 2000) await frame();
    const activeVisibleEarly = !!host.querySelector('.design-canvas[aria-label^="active.jpg"]');
    const partialSavePrevented = localStorage.getItem('yingkuang-session-v2') === JSON.stringify(session);
    release();
    await frame();
    const rows = [...host.querySelectorAll('.photo-row')];
    const persisted = JSON.parse(localStorage.getItem('yingkuang-session-v2'));
    const failures = [];
    if (!activeVisibleEarly) failures.push('Active photo was not restored first');
    if (!partialSavePrevented) failures.push('Partial restoration overwrote saved session');
    if (rows.length !== 2 || !rows[0].textContent.includes('first.jpg')) failures.push('Original library order was not preserved');
    if (inspections.join() !== 'active.jpg,first.jpg,missing.jpg') failures.push('StrictMode duplicated decoding');
    if (persisted.activePath !== 'active.jpg' || persisted.checkedPaths.join() !== 'first.jpg' || persisted.overridesByPath['active.jpg'].camera !== 'Restored Camera') failures.push('Restored selection or metadata was lost');
    if (!host.querySelector('.status-bar').textContent.includes('1 张原图已移动')) failures.push('Missing photo was not reported');
    if (!persisted.paths.includes('missing.jpg') || persisted.documentsByPath['missing.jpg']?.frame.paddingX !== 17 || persisted.overridesByPath['missing.jpg']?.camera !== 'Missing Camera') failures.push('Missing photo edits were overwritten during restoration');
    if (persisted.cropsByPath['missing.jpg']?.x !== .1 || persisted.cropsByPath['missing.jpg']?.rotation !== 13.7) failures.push('Missing photo crop was overwritten during restoration');
    const report = { activeVisibleEarly, partialSavePrevented, inspections, failures };
    if (failures.length) throw new Error(JSON.stringify(report));
    missingAvailable = true;
    host.querySelector('.library-import-actions button').click();
    for (let attempt = 0; attempt < 100 && host.querySelectorAll('.photo-row').length < 3; attempt++) await frame();
    const recovered = JSON.parse(localStorage.getItem('yingkuang-session-v2'));
    if (recovered.documentsByPath['missing.jpg']?.frame.paddingX !== 17 || recovered.overridesByPath['missing.jpg']?.camera !== 'Missing Camera' || host.querySelector('.missing-photos')) throw new Error('Reimport did not recover missing photo edits');
    if (recovered.checkedPaths.includes('missing.jpg')) throw new Error('Recovering an unchecked missing photo changed the export selection');
    if (recovered.cropsByPath['missing.jpg']?.width !== .5 || recovered.cropsByPath['missing.jpg']?.rotation !== 13.7) throw new Error('Reimport did not recover the missing crop');
    return { ...report, missingEditsPreserved: true, reimportRecovered: true, recoveredSelectionPreserved: true };
  } finally {
    release(); root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem('yingkuang-session-v2');
    else localStorage.setItem('yingkuang-session-v2', saved);
  }
})();
