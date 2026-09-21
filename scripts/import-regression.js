// Run on a disposable Vite browser session with agent-browser eval --stdin.
// Exercise the real App with Tauri's IPC mock, holding the second photo pending.
(async () => {
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const saved = localStorage.getItem('yingkuang-session-v2');
  localStorage.removeItem('yingkuang-session-v2');
  const photo = path => ({ id: path, path, fileName: path, width: 6000, height: 4000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} });
  let releaseSecond;
  const gate = new Promise(resolve => { releaseSecond = resolve; });
  const inspections = [];
  mockIPC(async (command, args) => {
    if (command === 'plugin:dialog|open') return ['first.jpg', 'broken.jpg', 'second.jpg', 'first.jpg'];
    if (command === 'inspect_images_resilient') {
      inspections.push(...args.paths);
      if (args.paths.includes('second.jpg')) await gate;
      return {
        items: args.paths.filter(path => path !== 'broken.jpg').map(photo),
        failures: args.paths.filter(path => path === 'broken.jpg').map(path => ({ path, reason: 'Unreadable fixture' })),
      };
    }
  }, { shouldMockEvents: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { default: App } = await import(`/src/App.tsx?import-regression=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await frame();
    const importButton = [...host.querySelectorAll('button')].find(button => button.textContent.includes('导入照片'));
    importButton.click();
    await frame();
    const firstVisibleBeforeBatchCompletes = !!host.querySelector('.design-canvas[aria-label^="first.jpg"]');
    releaseSecond();
    await frame();
    const importedCount = host.querySelectorAll('.photo-row').length;
    const firstRemainsActive = !!host.querySelector('.design-canvas[aria-label^="first.jpg"]');
    const failureReported = host.querySelector('.status-bar').textContent.includes('1 张无法读取');
    importButton.click();
    await frame();
    const failures = [];
    if (!firstVisibleBeforeBatchCompletes) failures.push('First photo is hidden until the whole batch finishes');
    if (importedCount !== 2) failures.push(`Expected 2 photos, received ${importedCount}`);
    if (!firstRemainsActive) failures.push('New arrivals changed the active photo');
    if (!failureReported) failures.push('Failed file was not reported');
    if (inspections.filter(path => path !== 'broken.jpg').length !== 2) failures.push('Reimport decoded photos already in the library');
    const report = { firstVisibleBeforeBatchCompletes, firstRemainsActive, importedCount, failureReported, inspections, failures };
    if (failures.length) throw new Error(JSON.stringify(report));
    return report;
  } finally {
    releaseSecond();
    root.unmount();
    host.remove();
    clearMocks();
    if (saved === null) localStorage.removeItem('yingkuang-session-v2');
    else localStorage.setItem('yingkuang-session-v2', saved);
  }
})();
