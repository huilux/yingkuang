// Exercise sizing, persistence, timer lifecycle and all task completion paths.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2', saved = localStorage.getItem(key);
  const originalInterval = window.setInterval, originalClear = window.clearInterval;
  const timers = new Set();
  window.setInterval = function(callback, delay, ...args) {
    const id = originalInterval.call(this, callback, delay, ...args);
    if (delay === 1000) timers.add(id);
    return id;
  };
  window.clearInterval = function(id) { timers.delete(id); return originalClear.call(this, id); };
  const reports = [];
  try {
    for (const mode of ['success', 'cancel', 'error']) {
      const document = createDefaultDocument();
      document.frame.paddingX = document.frame.paddingY = 4;
      for (const region of Object.values(document.regions)) region.enabled = false;
      document.regions.bottom = { ...document.regions.bottom, enabled: true, extra: 12 };
      localStorage.setItem(key, JSON.stringify({ paths: ['small.jpg'], checkedPaths: ['small.jpg'], documentsByPath: { 'small.jpg': document },
        exportSettings: { directory: '/output', range: 'current', size: 'long-edge', longEdge: 1200, ...(mode === 'success' ? {} : { noUpscale: true }) } }));
      let resolveExport, rejectExport, request, cancelled = false;
      mockIPC((command, args) => {
        if (command === 'inspect_images_resilient') return { items: [{ id: 'small.jpg', path: 'small.jpg', fileName: 'small.jpg', width: 600, height: 400, megapixels: 0.24, thumbnailDataUrl: '/demo.jpg', metadata: {} }], failures: [] };
        if (command === 'preflight_export') return { ready: true, warnings: [], errors: [] };
        if (command === 'export_images') { request = args.request; return new Promise((resolve, reject) => { resolveExport = resolve; rejectExport = reject; }); }
        if (command === 'cancel_export') cancelled = true;
      }, { shouldMockEvents: true });
      const host = window.document.createElement('div'); window.document.body.append(host);
      const root = createRoot(host);
      const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
      try {
        const { default: App } = await import(`/src/App.tsx?export-improvements=${mode}-${Date.now()}`);
        root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await t.waitFor(() => host.querySelector('.design-canvas'), 'Small photo not restored');
        button('导出当前').click();
        await t.waitFor(() => host.querySelector('.export-dialog'));
        const noUpscale = [...host.querySelectorAll('label')].find(label => label.textContent.includes('不放大小图')).querySelector('input');
        if (mode === 'success') {
          t.assert(!noUpscale.checked, 'Legacy settings changed fixed-long-edge behavior');
          noUpscale.click();
        } else t.assert(noUpscale.checked, 'Saved no-upscale preference was not restored');
        await t.waitFor(() => host.querySelector('.export-review').textContent.includes('632 × 480'), 'No-upscale preview is incorrect');
        t.assert(JSON.parse(localStorage.getItem(key)).exportSettings.noUpscale === true, 'Size preference was not persisted');
        button('预检并开始导出').click();
        await t.waitFor(() => host.querySelector('.progress-dialog'));
        t.assert(request.settings.noUpscale, 'No-upscale was omitted from the native request');
        await t.waitFor(() => /已用 [1-9]/.test(host.querySelector('.progress-dialog .export-elapsed').textContent), 'Elapsed time did not update');
        if (mode === 'cancel') { button('取消后续任务').click(); await t.waitFor(() => cancelled, 'Cancel command missing'); }
        if (mode === 'error') rejectExport('Worker unavailable');
        else resolveExport({ total: 1, succeeded: mode === 'success' ? 1 : 0, failed: 0, skipped: 0, cancelled,
          elapsedMs: 12500, outputDirectory: '/output', warnings: [], failures: [] });
        await t.waitFor(() => host.querySelector('.result-dialog'));
        t.assert(timers.size === 0, 'Elapsed timer continued after task completion');
        t.assert(!host.querySelector('.progress-dialog'), 'Completed task still shows progress');
        const text = host.querySelector('.result-dialog').textContent;
        t.assert(mode === 'error' ? text.includes('Worker unavailable') && /处理用时 [1-9]/.test(text) : text.includes('处理用时 12 秒'), 'Final elapsed time or error missing');
        if (mode === 'cancel') t.assert(text.includes('任务已取消') && text.includes('未处理 1 张') && text.includes('已停止后续导出'), 'Cancellation status missing');
        reports.push({ mode, noUpscalePreview: true, preferencePersisted: true, elapsedUpdated: true, timerStopped: true });
      } finally { root.unmount(); host.remove(); clearMocks(); }
    }
    return reports;
  } finally {
    for (const id of timers) originalClear.call(window, id);
    window.setInterval = originalInterval; window.clearInterval = originalClear;
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
