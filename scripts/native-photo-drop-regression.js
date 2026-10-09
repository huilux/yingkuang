// Native drag events must import paths through the same incremental EXIF pipeline.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const { emit, TauriEvent } = await import('/node_modules/@tauri-apps/api/event.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const keys = ['yingkuang-session-v2', 'yingkuang-default-template-v1'];
  const saved = keys.map(key => localStorage.getItem(key));
  localStorage.setItem(keys[0], JSON.stringify({paths: [], exportSettings: {directory: "/output"}}));
  let releaseSecond;
  const gate = new Promise(resolve => { releaseSecond = resolve; });
  const inspections = [];
  let resolutions = 0;
  mockIPC(async (command, args) => {
    if (command === 'preflight_export') return {ready: true, warnings: [], errors: []};
    if (command === 'export_images') return {total: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: false, elapsedMs: 1, outputDirectory: '/output', warnings: [], failures: []};
    if (command === 'resolve_photo_paths') {
      resolutions++;
      return { paths: ['/photos/first.JPG', '/photos/broken.png', '/photos/second.png', '/photos/first.JPG'], failures: [], ignored: 1 };
    }
    if (command === 'inspect_images_resilient') {
      const path = args.paths[0]; inspections.push(path);
      if (path.endsWith('second.png')) await gate;
      return { items: path.endsWith('broken.png') ? [] : [{ id: path, path, fileName: path.split('/').pop(), width: 600, height: 400, megapixels: .24, thumbnailDataUrl: '/demo.jpg', metadata: { camera: 'Native EXIF' } }], failures: path.endsWith('broken.png') ? [{ path, reason: 'Broken photo' }] : [] };
    }
  }, { shouldMockEvents: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  const drop = () => emit(TauriEvent.DRAG_DROP, { paths: ['/photos'], position: { x: 20, y: 30 } });
  try {
    const { default: App } = await import(`/src/App.tsx?native-drop=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => button('添加照片') && !button('添加照片').disabled, 'App not ready');
    const selector = host.querySelector('.library-template-select select');
    const templateId = selector.options[1].value;
    selector.value = templateId; selector.dispatchEvent(new Event('change', { bubbles: true })); await t.frame();
    await emit(TauriEvent.DRAG_ENTER, { paths: ['/photos'], position: { x: 20, y: 30 } }); await t.frame();
    t.assert(host.querySelector('.photo-drop-overlay')?.textContent.includes('松开鼠标'), 'No native drop feedback');
    t.assert(getComputedStyle(host.querySelector('.photo-drop-overlay')).pointerEvents === 'none', 'Overlay captures canvas gestures');
    await emit(TauriEvent.DRAG_LEAVE, null); await t.frame();
    t.assert(!host.querySelector('.photo-drop-overlay'), 'Leave did not clear overlay');
    await drop();
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 1 && inspections.length === 3, 'First photo hidden until batch completion');
    await drop(); await t.frame();
    t.assert(resolutions === 1, 'Concurrent drop started another import');
    releaseSecond();
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2 && !button('添加照片').disabled, 'Drop did not import photos');
    t.assert(host.querySelector('.design-canvas[aria-label^="first.JPG"]'), 'Batch changed active photo');
    t.assert(host.querySelector('.status-bar').textContent.includes('1 张无法读取'), 'Broken photo not reported');
    t.assert(host.querySelector('.status-bar').textContent.includes('忽略 1'), 'Unsupported file not reported');
    await t.waitFor(() => JSON.parse(localStorage.getItem(keys[0]) ?? '{}').templateIdsByPath?.['/photos/first.JPG'] === templateId, 'Drop template was not persisted: ' + localStorage.getItem(keys[0]) + ' / ' + (host.querySelector('.storage-notice')?.textContent ?? 'no storage issue'));
    const session = JSON.parse(localStorage.getItem(keys[0]));
    t.assert(session.templateIdsByPath['/photos/first.JPG'] === templateId, `Drop used stale default template: expected ${templateId}, got ${session.templateIdsByPath['/photos/first.JPG']}, selected ${selector.value}`);
    await drop(); await t.frame();
    t.assert(inspections.filter(path => !path.endsWith('broken.png')).length === 2, 'Duplicate drop decoded existing photos');
    button('导出当前').click(); await t.frame();
    const before = resolutions;
    await drop(); await t.frame();
    t.assert(resolutions === before, 'Drop mutated photos behind a dialog');
    button('预检并开始导出').click();
    await t.waitFor(() => host.querySelector('.result-dialog'), 'Export result missing');
    await drop(); await t.frame();
    t.assert(resolutions === before, 'Drop mutated photos behind export results');
    host.querySelector('.result-dialog button[aria-label="关闭"]').click(); await t.frame();
    root.unmount();
    await drop(); await t.frame();
    t.assert(resolutions === before, 'Unmount leaked native drag listener');
    return { nativeFeedback: true, leaveClearsOverlay: true, incrementalImport: true, deduplicated: true, busyAndDialogGuards: true, currentTemplateUsed: true, listenersCleaned: true };
  } finally {
    releaseSecond(); root.unmount(); host.remove(); clearMocks();
    keys.forEach((key, index) => saved[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[index]));
  }
})();
