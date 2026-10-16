(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const key = 'yingkuang-session-v2';
  const saved = localStorage.getItem(key);
  localStorage.setItem(key, JSON.stringify({ paths: ['drag-test.jpg'], activePath: 'drag-test.jpg' }));
  mockIPC(command => command === 'inspect_images_resilient' ? {
    items: [{ id: 'native-drag', path: 'drag-test.jpg', fileName: 'drag-test.jpg', width: 4000, height: 6000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} }], failures: [],
  } : undefined, { shouldMockEvents: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000';
  document.body.append(host);
  const root = createRoot(host);
  const originalWrite = Storage.prototype.setItem;
  let writes = 0;
  try {
    const { default: App } = await import(`/src/App.tsx?drag-persistence=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    const ctx = await t.context(host);
    await t.waitFor(() => ctx.stage.findOne('.preview-backdrop'), 'Native preview not ready');
    await t.disableSnap(ctx);
    const node = ctx.world.findOne('.watermark-layer');
    await t.zoom(ctx, 100); await t.centerNode(ctx, node);
    const initial = node.position();
    const origin = t.screen(ctx, node);
    t.mouse(ctx.content, 'mousedown', origin); t.mouse(window, 'mouseup', origin, 0); await t.frame();
    for (const name of ['光圈', '快门']) {
      const button = host.querySelector(`button[aria-label="选择图层 ${name}"]`);
      if (button.getAttribute('aria-pressed') !== 'true') button.dispatchEvent(new MouseEvent('click', { bubbles:true, shiftKey:true }));
      await t.frame();
    }
    const originals = ctx.world.find('.watermark-layer').filter(node => ['aperture','shutter','focal'].includes(node.id())).map(node => ({id:node.id(),x:node.x()}));
    Storage.prototype.setItem = function(name, value) {
      if (name === key) writes++;
      return originalWrite.call(this, name, value);
    };
    t.mouse(ctx.content, 'mousedown', origin); await t.frame();
    for (let i = 1; i <= 12; i++) {
      t.mouse(window, 'mousemove', { x: origin.x + i * 2, y: origin.y }); await t.frame();
    }
    t.assert(writes === 0, `Drag persisted ${writes} intermediate documents`);
    t.mouse(window, 'mouseup', { x: origin.x + 24, y: origin.y }, 0); await t.frame();
    t.assert(writes === 1, `Expected one drag commit, received ${writes}`);
    originals.forEach(item => t.near(ctx.world.findOne(node => node.id() === item.id).x() - item.x, 24 / ctx.world.scaleX(), 'Group member was not committed'));
    const persisted = JSON.parse(localStorage.getItem(key)).documentsByPath['drag-test.jpg'];
    const region = ctx.world.clipWidth();
    t.near(persisted.layers.find(layer => layer.id === node.id()).x * region, node.x(), 'Saved position differs from visible position', 0.01);
    host.querySelector('button[aria-label="撤销"]').click(); await t.frame();
    t.near(node.x(), initial.x, 'Native drag undo', 0.01);
    t.assert(host.querySelector('button[aria-label="撤销"]').disabled, 'One drag created multiple undo steps');
    host.querySelector('button[aria-label="重做"]').click(); await t.frame();
    t.assert(node.x() !== initial.x, 'Redo lost drag');
    // Re-mount through the actual session restoration path.
    root.unmount();
    const restoredRoot = createRoot(host);
    try {
      restoredRoot.render(React.createElement(App));
      const restored = await t.context(host);
      t.near(restored.world.findOne(layer => layer.id() === node.id()).x(), persisted.layers.find(layer => layer.id === node.id()).x * region, 'Restart lost committed position', 0.01);
    } finally { restoredRoot.unmount(); }
    return { intermediateWrites: 0, dragCommitWrites: 1, undoRedo: true, restored: true, portrait: true, multiSelection: true };
  } finally {
    Storage.prototype.setItem = originalWrite;
    root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
