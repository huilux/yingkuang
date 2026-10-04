(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2', previous = localStorage.getItem(key), reports = [];
  try {
    for (const mode of ['only-missing', 'mixed', 'single-record']) {
      localStorage.setItem(key, JSON.stringify({ paths: mode !== 'only-missing' ? ['missing.jpg', 'available.jpg'] : ['missing.jpg'], checkedPaths: ['missing.jpg'],
        documentsByPath: { 'missing.jpg': createDefaultDocument() }, overridesByPath: { 'missing.jpg': { camera: 'Keep until confirmed' } } }));
      mockIPC((command, args) => command === 'inspect_images_resilient' ? {
        items: args.paths.filter(path => path === 'available.jpg').map(path => ({ id: path, path, fileName: path, width: 600, height: 400, megapixels: .24, thumbnailDataUrl: '/demo.jpg', metadata: {} })),
        failures: args.paths.filter(path => path === 'missing.jpg').map(path => ({ path, reason: 'Missing' })),
      } : undefined, { shouldMockEvents: true });
      const host = document.createElement('div'); document.body.append(host);
      let root = createRoot(host);
      try {
        const { default: App } = await import(`/src/App.tsx?missing-removal=${mode}-${Date.now()}`);
        root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await t.waitFor(() => host.querySelector('.missing-photos') && host.querySelector('.status-bar').textContent.includes('原图已移动'));
        // The visible restore status can precede the passive persistence effect.
        await t.waitFor(() => JSON.parse(localStorage.getItem(key)).dimensionsByPath !== undefined, 'Restored session was not saved');
        const before = localStorage.getItem(key);
        host.querySelector('.missing-photos').open = true;
        const clear = mode === 'single-record' ? host.querySelector('[aria-label="移除缺失记录 missing.jpg"]') : host.querySelector('.library-clear-button');
        t.assert(!clear.disabled, 'A batch containing only missing photos cannot be cleared');
        clear.click(); await t.waitFor(() => host.querySelector('[aria-labelledby="remove-title"]'));
        const dialog = host.querySelector('[aria-labelledby="remove-title"]');
        t.assert(dialog.textContent.includes('缺失'), 'Confirmation hides removal of missing-photo edits');
        [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消').click(); await t.frame();
        t.assert(localStorage.getItem(key) === before, 'Cancellation removed missing edits');
        clear.click(); await t.frame();
        [...host.querySelectorAll('button')].find(button => button.textContent === '确认移除').click();
        const expectedPaths = mode === 'single-record' ? ['available.jpg'] : [];
        await t.waitFor(() => JSON.parse(localStorage.getItem(key)).paths.join() === expectedPaths.join(), 'Removal changed the wrong photo records');
        const saved = JSON.parse(localStorage.getItem(key));
        t.assert(!host.querySelector('.missing-photos') && !saved.documentsByPath['missing.jpg'] && !saved.overridesByPath['missing.jpg'], 'Removed edits remain in session');
        root.unmount(); root = createRoot(host); root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await t.waitFor(() => host.querySelector(mode === 'single-record' ? '.photo-row' : '.library-empty')); await t.frame();
        t.assert(!host.querySelector('.missing-photos') && JSON.parse(localStorage.getItem(key)).paths.join() === expectedPaths.join(), 'Missing photos returned after restart');
        reports.push({ mode, cancelPreservedEdits: true, removedIntendedRecords: true, restartPreservedScope: true });
      } finally { root.unmount(); host.remove(); clearMocks(); }
    }
    return reports;
  } finally { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); }
})();
