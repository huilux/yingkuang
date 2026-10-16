// Export must receive the latest per-photo document, including unsaved canvas edits.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  const current = t.withBrandFixture(createDefaultDocument());
  const brand = current.layers.find(layer => layer.id === 'brand');
  brand.customValue = 'LATEST CANVAS';
  brand.x = 0.42;
  brand.fontSize = 47;
  localStorage.setItem(key, JSON.stringify({
    paths: ['export-current.jpg'],
    activePath: 'export-current.jpg',
    checkedPaths: ['export-current.jpg'],
    documentsByPath: { 'export-current.jpg': current },
    exportSettings: { directory: '/tmp', range: 'current' },
  }));
  let exported;
  mockIPC((command, args) => {
    if (command === 'inspect_images_resilient') return {
      items: [{ id: 'export-current.jpg', path: 'export-current.jpg', fileName: 'export-current.jpg', width: 6000, height: 4000,
        megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} }],
      failures: [],
    };
    if (command === 'export_images') {
      exported = args.request;
      return { total: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: false, outputDirectory: '/tmp', failures: [], warnings: [] };
    }
    if (command === 'preflight_export') return {
      ready: true, total: 1, estimatedPixels: 1_200_000, largestWidth: 1200, largestHeight: 900,
      largestFileName: 'export-current.jpg', errors: [], warnings: [],
    };
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { default: App } = await import(`/src/App.tsx?export-document=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelector('.design-canvas'), 'Photo was not restored');
    [...host.querySelectorAll('button')].find(button => button.textContent.includes('导出当前')).click();
    await t.waitFor(() => host.querySelector('[role="dialog"]'), 'Export dialog did not open');
    [...host.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes('开始导出')).click();
    await t.waitFor(() => exported, 'Export IPC was not called');
    const output = exported.items[0].document.layers.find(layer => layer.id === 'brand');
    t.assert(output.customValue === 'LATEST CANVAS' && output.x === 0.42 && output.fontSize === 47,
      `Export received stale document: ${JSON.stringify(output)}`);
    return { latestDocumentExported: true, text: output.customValue, x: output.x, fontSize: output.fontSize };
  } finally {
    root.unmount();
    host.remove();
    clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
