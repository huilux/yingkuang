// Recover moved originals through the UI, preserving edits across export and restart.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2', previous = localStorage.getItem(key);
  const old = '/old/checked.jpg', unchecked = '/old/unchecked.jpg', moved = '/new/portrait.jpg', second = '/new/unchecked.jpg', existing = '/photos/existing.jpg';
  const document = createDefaultDocument(); document.frame.paddingX = 17;
  localStorage.setItem(key, JSON.stringify({ paths: [existing, old, unchecked], activePath: existing, checkedPaths: [old],
    documentsByPath: { [old]: document, [unchecked]: document }, overridesByPath: { [old]: { camera: 'Recovered Camera' }, [unchecked]: { camera: '' } },
    templateIdsByPath: { [old]: 'wide-float' }, dimensionsByPath: { [old]: { width: 6000, height: 4000 } },
    cropsByPath: { [old]: { x: .1, y: .2, width: .5, height: .5, rotation: -103.7 } },
    exportSettings: { directory: '/output', range: 'current' } }));
  let selection = null;
  const inspections = [], exports = [];
  mockIPC((command, args) => {
    if (command === 'plugin:dialog|open') return selection;
    if (command === 'inspect_images_resilient') {
      inspections.push(...args.paths);
      return { items: args.paths.filter(path => ![old, unchecked, '/broken.jpg'].includes(path)).map(path => ({ id: path, path, fileName: path.split('/').pop(), width: path === moved ? 300 : 600, height: path === moved ? 450 : 400, megapixels: 0.24, thumbnailDataUrl: '/demo.jpg', metadata: {} })),
        failures: args.paths.filter(path => [old, unchecked, '/broken.jpg'].includes(path)).map(path => ({ path, reason: '无法解码照片' })) };
    }
    if (command === 'preflight_export') return { ready: true, warnings: [], errors: [] };
    if (command === 'export_images') {
      exports.push(args.request);
      return { total: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: false, elapsedMs: 10, outputDirectory: '/output', warnings: [], failures: [] };
    }
  }, { shouldMockEvents: true });
  const host = window.document.createElement('div'); window.document.body.append(host);
  let root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  const saved = () => JSON.parse(localStorage.getItem(key));
  const locate = name => host.querySelector(`[aria-label="重新定位 ${name}"]`);
  const ready = async () => { await t.waitFor(() => host.querySelector('.missing-photos')); host.querySelector('.missing-photos').open = true; await t.frame(); };
  try {
    const { default: App } = await import(`/src/App.tsx?photo-relink=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await ready();
    const before = localStorage.getItem(key);
    locate('checked.jpg').click(); await t.frame();
    t.assert(localStorage.getItem(key) === before, 'Cancelling the picker changed session data');
    selection = existing;
    const count = inspections.length;
    locate('checked.jpg').click(); await t.waitFor(() => host.querySelector('.missing-photos [role="alert"]'));
    t.assert(inspections.length === count, 'Duplicate existing photo was unnecessarily decoded');
    t.assert(localStorage.getItem(key) === before, 'Duplicate selection overwrote session');
    selection = '/broken.jpg'; locate('checked.jpg').click();
    await t.waitFor(() => host.querySelector('.missing-photos [role="alert"]')?.textContent.includes('无法解码'));
    t.assert(localStorage.getItem(key) === before, 'Broken selection overwrote session');
    selection = moved; locate('checked.jpg').click();
    await t.waitFor(() => host.querySelector('.relink-dialog'));
    t.assert(host.querySelector('.relink-dialog').textContent.includes('6000 × 4000') && host.querySelector('.relink-dialog').textContent.includes('300 × 450'), 'Old and replacement dimensions missing');
    host.querySelector('.relink-dialog [data-modal-initial]').click(); await t.frame();
    t.assert(localStorage.getItem(key) === before, 'Cancelling confirmation changed session');
    locate('checked.jpg').click(); await t.waitFor(() => host.querySelector('.relink-dialog'));
    button('使用此照片恢复').click();
    await t.waitFor(() => saved().paths.includes(moved) && !host.querySelector('.relink-dialog'));
    t.assert(saved().paths.join() === [existing, moved, unchecked].join(), 'Photo order was lost');
    t.assert(saved().documentsByPath[moved].frame.paddingX === 17 && saved().overridesByPath[moved].camera === 'Recovered Camera', 'Edits were not recovered');
    t.assert(saved().checkedPaths.includes(moved) && !saved().checkedPaths.includes(old), 'Checked selection was not moved');
    t.assert(saved().templateIdsByPath[moved] === 'wide-float', 'Template association was lost');
    t.assert(saved().dimensionsByPath[moved].width === 300, 'New dimensions were not saved');
    t.assert(saved().cropsByPath[moved]?.x === .1 && saved().cropsByPath[moved]?.rotation === -103.7 && !saved().cropsByPath[old], 'Crop was not relocated');
    button('导出当前').click(); await t.waitFor(() => host.querySelector('.export-dialog'));
    button('预检并开始导出').click(); await t.waitFor(() => host.querySelector('.result-dialog'));
    t.assert(exports[0].items[0].path === moved && exports[0].items[0].document.frame.paddingX === 17 && exports[0].items[0].overrides.camera === 'Recovered Camera', 'Export did not use the recovered original and edits');
    t.assert(exports[0].items[0].crop?.width === .5 && exports[0].items[0].crop?.rotation === -103.7, 'Export lost relocated crop');
    host.querySelector('.result-dialog [aria-label="关闭"]').click(); await t.frame();
    selection = second; locate('unchecked.jpg').click(); await t.waitFor(() => host.querySelector('.relink-dialog'));
    button('使用此照片恢复').click(); await t.waitFor(() => !host.querySelector('.missing-photos'));
    t.assert(!saved().checkedPaths.includes(second) && saved().overridesByPath[second].camera === '', 'Unchecked state or empty override was lost');
    root.unmount(); root = createRoot(host); root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 3 && host.querySelector('.status-bar').textContent.includes('已恢复'));
    t.assert(!host.querySelector('.missing-photos') && saved().documentsByPath[moved].frame.paddingX === 17 && saved().checkedPaths.join() === moved, 'Restart did not retain relocated edits and selection');
    t.assert(saved().cropsByPath[moved]?.height === .5 && saved().cropsByPath[moved]?.rotation === -103.7, 'Restart lost relocated crop');
    return { pickerCancelSafe: true, duplicateBlocked: true, unreadableBlocked: true, confirmationCancelSafe: true, dimensionsVisible: true,
      orderPreserved: true, editsAndSelectionPreserved: true, exportedNewPath: true, restartRecovered: true };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
  }
})();
