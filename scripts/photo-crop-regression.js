// Exercise the complete native-facing workflow with IPC mocks; Rust tests encode real files.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { createDefaultDocument } = await import('/src/editor-model.ts');
  const { buildExportPlan } = await import('/src/export-workflow.ts');
  const { rasterize } = await import('/src/use-preview-backdrop.ts');
  const { calculateGeometry } = await import('/src/editor-model.ts');
  const key = 'yingkuang-session-v2'; const saved = localStorage.getItem(key);
  const photos = ['a', 'b'].map(id => ({ id, path: `/${id}.png`, fileName: `${id}.png`, width: 6000, height: 4000,
    megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} }));
  const initialCrop = { x: .25, y: .25, width: .5, height: .5 };
  localStorage.setItem(key, JSON.stringify({ paths: ['/a.png', '/b.png'], activePath: '/a.png', checkedPaths: ['/a.png', '/b.png'],
    cropsByPath: { '/b.png': initialCrop }, exportSettings: { directory: '/tmp', range: 'all', size: 'original' } }));
  let exported;
  mockIPC((command, args) => {
    if (command === 'inspect_images_resilient') return { items: photos.filter(photo => args.paths.includes(photo.path)), failures: [] };
    if (command === 'load_editor_photo') return '/demo.jpg';
    if (command === 'preflight_export') return { ready: true, total: 2, errors: [], warnings: [], estimatedPixels: 1, largestWidth: 1, largestHeight: 1, largestFileName: 'a.png' };
    if (command === 'export_images') { exported = args.request; return { total: 2, succeeded: 2, failed: 0, skipped: 0, cancelled: false, elapsedMs: 20, outputDirectory: '/tmp', failures: [], warnings: [] }; }
  }, { shouldMockEvents: true });
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:1000'; document.body.append(host);
  let root = createRoot(host);
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  const snapshot = () => JSON.parse(localStorage.getItem(key));
  const field = label => host.querySelector(`.crop-dialog input[aria-label="${label}"]`);
  async function setField(label, value) { const input = field(label); input.focus(); t.change(input, value); await t.frame(); input.blur(); await t.frame(); }
  async function open() { (button('调整裁切与旋转') ?? button('裁切与旋转')).click(); await t.waitFor(() => field('选区宽度'), 'Crop editor did not open'); await t.frame(); }
  try {
    const { default: App } = await import(`/src/App.tsx?crop-regression=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2 && snapshot().paths.length === 2, 'Photos not restored');
    await t.zoom(await t.context(host), 200);
    await open();
    await setField('选区宽度', 1500); await setField('选区高度', 2000); await setField('左侧位置', 1000); await setField('顶部位置', 800);
    button('取消').click(); await t.frame();
    t.assert(!snapshot().cropsByPath['/a.png'], 'Cancel applied a draft crop');
    await open(); t.assert(Number(field('选区宽度').value) === 6000, 'Cancel lost original extent');
    button('自由比例').click(); await t.frame();
    [...host.querySelectorAll('[role=option]')].find(option => option.textContent.trim() === '1:1').click(); await t.frame();
    t.assert(field('选区宽度').value === field('选区高度').value, 'Square ratio is not locked');
    await setField('选区宽度', 2000);
    t.assert(Number(field('选区高度').value) === 2000, 'Numeric edit broke locked ratio');
    button('1:1').click(); await t.frame();
    [...host.querySelectorAll('[role=option]')].find(option => option.textContent.trim() === '3:2').click(); await t.frame();
    button('切换横竖').click(); await t.frame();
    t.assert(Math.abs(Number(field('选区宽度').value) / Number(field('选区高度').value) - 2/3) < .001, 'Ratio flip failed');
    button('重置为完整照片').click(); await t.frame();
    await setField('选区宽度', 1500); await setField('选区高度', 2000); await setField('左侧位置', 1000); await setField('顶部位置', 800);
    const viewport = host.querySelector('.crop-viewport'); viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })); await t.frame();
    t.assert(Number(field('左侧位置').value) === 1010, 'Keyboard crop movement failed');
    const wheel = new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, bubbles: true, cancelable: true, clientX: viewport.getBoundingClientRect().left + 100, clientY: viewport.getBoundingClientRect().top + 100 });
    viewport.dispatchEvent(wheel); await t.frame(); t.assert(wheel.defaultPrevented, 'Crop zoom escaped to browser');
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true })); await t.frame();
    t.assert(Number(field('左侧位置').value) === 1010 && Number(field('选区宽度').value) === 1500, 'View movement changed crop pixels');
    const dialog = host.querySelector('.crop-dialog').getBoundingClientRect(); const footer = host.querySelector('.crop-dialog footer').getBoundingClientRect();
    t.assert(dialog.top >= 0 && dialog.bottom <= innerHeight + 1 && footer.bottom <= innerHeight, 'Crop actions exceed window');
    button('应用调整').click(); await t.frame();
    const crop = snapshot().cropsByPath['/a.png'];
    t.assert(crop.width === .25 && crop.height === .5, 'Applied crop was not persisted');
    const ctx = await t.context(host); const preview = ctx.stage.findOne('.preview-photo');
    t.near(preview.width() / preview.height(), .75, 'Preview aspect mismatch', .0001);
    const world = ctx.stage.findOne('.background-world');
    t.near(world.x() + world.findOne('Rect').width() * world.scaleX() / 2, ctx.stage.width() / 2, 'Applied crop did not fit after zoom');
    host.querySelector('[aria-label="撤销"]').click(); await t.frame(); t.assert(!snapshot().cropsByPath['/a.png'], 'Undo did not restore full photo');
    host.querySelector('[aria-label="重做"]').click(); await t.frame(); t.assert(snapshot().cropsByPath['/a.png'].width === .25, 'Redo did not restore crop');
    host.querySelector('[aria-label="预览 b.png"]').click(); await t.frame(); await open();
    t.assert(Number(field('选区宽度').value) === 3000 && Number(field('左侧位置').value) === 1500, 'Per-photo crop was overwritten');
    host.querySelector('.crop-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await t.frame();
    t.assert(!host.querySelector('.crop-dialog'), 'Escape did not cancel crop');
    button('将当前画布应用到已勾选 2 张').click(); await t.frame();
    t.assert(snapshot().cropsByPath['/a.png'].width === .25 && snapshot().cropsByPath['/b.png'].width === .5, 'Batch style application copied crop');
    host.querySelector('[aria-label="预览 a.png"]').click(); await t.frame();
    button('重新套用')?.click(); await t.frame(); t.assert(snapshot().cropsByPath['/a.png'].width === .25, 'Template application reset crop');
    button('批量导出').click(); await t.frame();
    const settings = snapshot().exportSettings;
    const expected = buildExportPlan({ photos: photos.map(photo => ({ ...photo, crop: snapshot().cropsByPath[photo.path] })), documents: { a: snapshot().documentsByPath['/a.png'], b: snapshot().documentsByPath['/b.png'] }, settings, activeId: 'a', checkedIds: ['a', 'b'] });
    t.assert(host.querySelector('.export-dialog').textContent.includes(expected.sampleDimensions), 'Export preview ignored crop');
    button('预检并开始导出').click(); await t.waitFor(() => exported, 'Export request missing');
    t.assert(exported.items[0].crop.width === .25 && exported.items[1].crop.width === .5, 'Export did not freeze each photo crop');
    host.querySelector('.result-dialog [aria-label="关闭"]').click(); await t.frame();
    root.unmount(); root = createRoot(host); root.render(React.createElement(App));
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2, 'Restart failed');
    await open(); t.assert(Number(field('选区宽度').value) === 1500, 'Restart lost crop');
    button('重置为完整照片').click(); await t.frame();
    const cropStage = host.querySelector('.crop-viewport'); cropStage.focus();
    cropStage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await t.frame();
    t.assert(!snapshot().cropsByPath['/a.png'] && snapshot().cropsByPath['/b.png'].width === .5, 'Reset affected another photo');
    // The blurred backdrop must also exclude the discarded blue half.
    const source = document.createElement('canvas'); source.width = 200; source.height = 100;
    const sourceContext = source.getContext('2d'); sourceContext.fillStyle = '#ef140a'; sourceContext.fillRect(0, 0, 100, 100); sourceContext.fillStyle = '#0000fa'; sourceContext.fillRect(100, 0, 100, 100);
    const sample = { ...photos[0], width: 200, height: 100, crop: { x: 0, y: 0, width: .5, height: 1 }, thumbnailDataUrl: source.toDataURL() };
    const doc = createDefaultDocument(); doc.frame.type = 'blur'; doc.frame.blur = 10; doc.frame.shadow = 0; doc.frame.brightness = 100;
    const backdrop = await rasterize(sample.thumbnailDataUrl, doc.frame, calculateGeometry(sample, doc), new AbortController().signal, false, 560, sample);
    const pixel = backdrop.getContext('2d').getImageData(20, 20, 1, 1).data;
    t.assert(pixel[0] > pixel[2] * 4, 'Discarded blue pixels remain in blurred backdrop');
    return { cancel: true, ratios: true, numeric: true, keyboard: true, zoomAndPan: true, undoRedo: true, templatePreservesCrop: true, independentBatch: true, exportRequest: true, restart: true, reset: true, croppedBackdrop: true };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
})();
