// Export dialog must validate before IPC and behave as a keyboard-modal workflow.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  localStorage.setItem(key, JSON.stringify({
    paths: ['export-workflow.jpg'],
    activePath: 'export-workflow.jpg',
    checkedPaths: ['export-workflow.jpg'],
    documentsByPath: { 'export-workflow.jpg': createDefaultDocument() },
    exportSettings: { directory: '/tmp', range: 'current' },
  }));
  mockIPC(command => {
    if (command === 'inspect_images_resilient') return {
      items: [{ id: 'export-workflow.jpg', path: 'export-workflow.jpg', fileName: 'export-workflow.jpg', width: 6000, height: 4000,
        megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} }],
      failures: [],
    };
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { default: App } = await import(`/src/App.tsx?export-workflow=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelector('.design-canvas'), 'Photo was not restored');
    const trigger = [...host.querySelectorAll('button')].find(button => button.textContent.includes('导出当前'));
    trigger.focus();
    trigger.click();
    await t.waitFor(() => host.querySelector('.export-dialog'), 'Export dialog did not open');
    await t.waitFor(() => host.querySelector('.export-dialog').contains(document.activeElement), 'Focus did not enter export dialog');
    const dialog = host.querySelector('.export-dialog');
    const size = [...dialog.querySelectorAll('label')].find(label => label.textContent.includes('成品尺寸')).querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(size, 'long-edge');
    size.dispatchEvent(new Event('change', { bubbles: true }));
    await t.waitFor(() => [...dialog.querySelectorAll('label')].some(label => label.textContent.includes('成品长边像素')), 'Long-edge input missing');
    const longEdge = [...dialog.querySelectorAll('label')].find(label => label.textContent.includes('成品长边像素')).querySelector('input');
    t.change(longEdge, 0);
    await t.frame();
    const submit = [...dialog.querySelectorAll('button')].find(button => button.textContent.includes('开始导出'));
    t.assert(submit.disabled, 'Invalid long edge did not block export');
    t.assert(dialog.textContent.includes('800–30000'), 'Long-edge validation is not visible');
    t.change(longEdge, 1200);
    const suffix = [...dialog.querySelectorAll('label')].find(label => label.textContent.includes('文件名后缀')).querySelector('input');
    t.change(suffix, '../escape');
    await t.frame();
    t.assert(submit.disabled, 'Unsafe filename suffix did not block export');
    t.assert(dialog.textContent.includes('系统保留字符'), 'Suffix validation is not visible');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await t.waitFor(() => !host.querySelector('.export-dialog'), 'Escape did not close export dialog');
    await t.waitFor(() => document.activeElement === trigger, 'Focus did not return to export trigger');
    return { focusEntered: true, invalidLongEdgeBlocked: true, unsafeSuffixBlocked: true, escapeClosed: true, focusRestored: true };
  } finally {
    root.unmount();
    host.remove();
    clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
