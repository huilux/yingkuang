(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  const originalWrite = Storage.prototype.setItem;
  const reports = [];
  mockIPC(command => command === 'inspect_images_resilient' ? { items: [], failures: [] } : undefined, { shouldMockEvents: true });
  try {
    const { default: App } = await import(`/src/App.tsx?session-failure=${Date.now()}`);
    for (const mode of ['corrupt', 'quota']) {
      const source = mode === 'corrupt' ? '{"paths":' : '{"paths":[]}';
      originalWrite.call(localStorage, key, source);
      if (mode === 'quota') Storage.prototype.setItem = function(name, value) {
        if (name === key) throw new DOMException('Storage full', 'QuotaExceededError');
        return originalWrite.call(this, name, value);
      };
      const host = document.createElement('div'); document.body.append(host);
      const root = createRoot(host);
      try {
        root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await t.waitFor(() => host.querySelector('.storage-notice'), `${mode} failure was not visible`);
        t.assert(localStorage.getItem(key) === source, `${mode} failure overwrote original session`);
        t.assert(host.querySelector('.library-import-actions button'), `${mode} failure broke editor`);
        reports.push({ mode, originalPreserved: true, visibleNotice: true });
      } finally { root.unmount(); host.remove(); Storage.prototype.setItem = originalWrite; }
    }
    return reports;
  } finally {
    Storage.prototype.setItem = originalWrite; clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
