// Retry must remain attached to the failed request even when the active photo changes.
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
  localStorage.setItem(key, JSON.stringify({
    paths: ['retry-first.jpg', 'retry-second.jpg'], activePath: 'retry-first.jpg', checkedPaths: ['retry-first.jpg'],
    documentsByPath: { 'retry-first.jpg': createDefaultDocument(), 'retry-second.jpg': createDefaultDocument() },
    exportSettings: { directory: '/original-output', range: 'current' },
  }));
  mockIPC((command, args) => {
    if (command === 'inspect_images_resilient') return {
      items: args.paths.map(path => ({ id: path, path, fileName: path, width: 6000, height: 4000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} })), failures: [],
    };
    if (command === 'preflight_export') return { ready: true, total: 1, warnings: [], errors: [] };
    if (command === 'export_images') {
      requests.push(structuredClone(args.request));
      return { total: 1, succeeded: requests.length === 1 ? 0 : 1, failed: requests.length === 1 ? 1 : 0, skipped: 0, cancelled: false,
        outputDirectory: args.request.settings.directory, warnings: [],
        failures: requests.length === 1 ? [{ path: 'retry-first.jpg', fileName: 'retry-first.jpg', reason: '临时写入失败' }] : [] };
    }
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  try {
    const { default: App } = await import(`/src/App.tsx?export-retry=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2, 'Photos were not restored');
    button('导出当前').click();
    await t.waitFor(() => host.querySelector('.export-dialog'), 'Export settings missing');
    button('预检并开始导出').click();
    await t.waitFor(() => button('重试失败项'), 'Failed export result missing');
    // Simulate subsequent editor selection; retry must not derive its scope from it.
    host.querySelectorAll('.photo-row')[1].querySelector('.photo-open-button').click();
    await t.frame();
    button('重试失败项').click();
    await t.waitFor(() => requests.length === 2, 'Retry did not run after active photo changed');
    t.assert(JSON.stringify(requests[1]) === JSON.stringify(requests[0]), 'Retry changed the original document or export settings');
    return { retriesOriginalPhoto: true, preservesDocumentAndSettings: true, requests: requests.length };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
