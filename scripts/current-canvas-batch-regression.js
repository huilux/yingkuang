// The batch action must copy the edited canvas, even when the saved template is stale.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  const source = createDefaultDocument();
  source.layers.find(layer => layer.id === 'brand').customValue = 'CURRENT UNSAVED';
  const other = createDefaultDocument();
  other.layers.find(layer => layer.id === 'brand').customValue = 'SECOND ORIGINAL';
  localStorage.setItem(key, JSON.stringify({
    paths: ['first.jpg', 'second.jpg'],
    activePath: 'first.jpg',
    checkedPaths: ['first.jpg', 'second.jpg'],
    documentsByPath: { 'first.jpg': source, 'second.jpg': other },
    activeTemplate: 'blur-bottom',
  }));
  mockIPC((command, args) => command === 'inspect_images_resilient' ? {
    items: args.paths.map(path => ({
      id: path,
      path,
      fileName: path,
      width: 6000,
      height: 4000,
      megapixels: 24,
      thumbnailDataUrl: '/demo.jpg',
      metadata: {},
    })),
    failures: [],
  } : undefined, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { default: App } = await import(`/src/App.tsx?current-canvas-batch=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2, 'Two photos were not restored');
    const action = [...host.querySelectorAll('button')].find(button => button.textContent.includes('将当前画布应用'));
    t.assert(action, 'Current-canvas batch action is missing');
    action.click();
    await t.frame();
    const session = JSON.parse(localStorage.getItem(key));
    const first = session.documentsByPath['first.jpg'].layers.find(layer => layer.id === 'brand').customValue;
    const second = session.documentsByPath['second.jpg'].layers.find(layer => layer.id === 'brand').customValue;
    t.assert(first === 'CURRENT UNSAVED' && second === 'CURRENT UNSAVED',
      `Batch action copied a saved template instead of the canvas: ${first}, ${second}`);
    const undo = host.querySelector('button[aria-label="撤销"]');
    t.assert(undo && !undo.disabled, 'Batch apply did not create an undo step');
    host.querySelectorAll('.photo-open-button')[1].click();
    await t.frame();
    undo.click();
    await t.frame();
    const undone = JSON.parse(localStorage.getItem(key));
    t.assert(undone.documentsByPath['first.jpg'].layers.find(layer => layer.id === 'brand').customValue === 'CURRENT UNSAVED', 'Undo changed the source document');
    t.assert(undone.documentsByPath['second.jpg'].layers.find(layer => layer.id === 'brand').customValue === 'SECOND ORIGINAL', 'Undo did not restore the second document after switching photos');
    host.querySelector('button[aria-label="重做"]').click();
    await t.frame();
    const redone = JSON.parse(localStorage.getItem(key));
    t.assert(redone.documentsByPath['second.jpg'].layers.find(layer => layer.id === 'brand').customValue === 'CURRENT UNSAVED', 'Redo did not restore the batch operation');
    return { copiedCurrentCanvas: true, targets: 2, undoAfterPhotoSwitch: true, redoBatch: true };
  } finally {
    root.unmount();
    host.remove();
    clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
