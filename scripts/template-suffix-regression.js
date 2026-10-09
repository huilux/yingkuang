// Exercise template naming through the real export dialog and IPC request.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { builtInTemplates, createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  const templates = builtInTemplates();
  const requests = [];
  localStorage.setItem(key, JSON.stringify({ paths: ['/photos/a.jpg', '/photos/b.jpg'], checkedPaths: ['/photos/a.jpg', '/photos/b.jpg'],
    documentsByPath: { '/photos/a.jpg': createDefaultDocument(), '/photos/b.jpg': createDefaultDocument() },
    templateIdsByPath: { '/photos/a.jpg': templates[0].id, '/photos/b.jpg': templates[1].id },
    exportSettings: { directory: '/output', suffixMode: 'template', suffix: '../unused' } }));
  mockIPC((command, args) => {
    if (command === 'inspect_images_resilient') return { items: args.paths.map(path => ({ id: path, path, fileName: path.split('/').pop(), width: 600, height: 400, megapixels: .24, thumbnailDataUrl: '/demo.jpg', metadata: {} })), failures: [] };
    if (command === 'preflight_export') {
      requests.push(structuredClone(args.request));
      return { ready: true, warnings: [], errors: [] };
    }
    if (command === 'export_images') return { total: 2, succeeded: 2, failed: 0, skipped: 0, cancelled: false, elapsedMs: 1, outputDirectory: '/output', warnings: [], failures: [] };
  }, { shouldMockEvents: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  try {
    const { default: App } = await import(`/src/App.tsx?template-suffix=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2, 'Photos not restored');
    button('批量导出').click(); await t.frame();
    t.assert(host.querySelector('.export-review code').textContent === `a-${templates[0].name}.jpg`, 'Preview does not use the first photo template');
    const toggle = [...host.querySelectorAll('label')].find(label => label.textContent === '使用相框名称').querySelector('input');
    toggle.click(); await t.frame();
    const custom = host.querySelector('input[aria-invalid]');
    t.assert(custom.value === '../unused', 'Custom suffix was lost');
    t.change(custom, '-自定义'); await t.frame();
    t.assert(host.querySelector('.export-review code').textContent === 'a-自定义.jpg', 'Custom suffix preview is wrong');
    toggle.click(); await t.frame();
    button('预检并开始导出').click();
    await t.waitFor(() => host.querySelector('.result-dialog'), 'Template export failed');
    t.assert(requests.length === 1 && requests[0].settings.suffix === '', 'Inactive custom suffix leaked to native validation');
    t.assert(requests[0].items[0].outputSuffix === `-${templates[0].name}` && requests[0].items[1].outputSuffix === `-${templates[1].name}`, 'Batch does not use each photo template');
    return { perPhotoTemplateNames: true, previewMatchesRequest: true, customSuffixRetained: true };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
