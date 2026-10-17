// Integration tests for the real thumbnail component and the editor painter.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  // Tauri clearMocks leaves an empty internal object after native-only tests.
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke !== 'function') delete window.__TAURI_INTERNALS__;
  const resource = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path).name;
  const { default: React } = await import(resource('/node_modules/.vite/deps/react.js'));
  const { default: { createRoot } } = await import(resource('/node_modules/.vite/deps/react-dom_client.js'));
  const library = await import(resource('/src/font-library.ts'));
  const { layoutWatermarkText, paintWatermarkText } = await import('/src/watermark-text.ts');
  const { TemplatePreview } = await import('/src/TemplatePreview.tsx');
  const { EditorCanvas } = await import('/src/EditorCanvas.tsx');
  const { createDefaultDocument, calculateGeometry } = await import('/src/editor-model.ts');
  await library.ensureFontsLoaded(['Allura', 'Cinzel', 'Long Cang']);
  function bounds(canvas, start = 0, end = canvas.width, opaque = false) {
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let top = height, bottom = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) for (let x = Math.max(0, Math.ceil(start)); x < Math.min(width, Math.floor(end)); x++) {
      const i = (y * width + x) * 4;
      if ((opaque ? data[i] : data[i + 3]) <= 32) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
    t.assert(bottom >= top, 'Expected visible text ink');
    return { centerY: (top + bottom + 1) / 2, left, right, top, bottom };
  }
  const long = [];
  for (const [text, fontSize] of [['名字123', 80], ['名字' + '123'.repeat(100), 80], ['名字123', 1000]]) {
    const layout = layoutWatermarkText({ fontFamily: 'Long Cang', fontSize, fontWeight: 400 }, text);
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(layout.width + 10); canvas.height = fontSize + 40;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    ctx.translate(5, 10); paintWatermarkText(ctx, layout, '#fff');
    const edge = layout.runs[1].x + 5;
    const centers = [bounds(canvas, 5, edge).centerY, bounds(canvas, edge, canvas.width).centerY];
    t.assert(Math.abs(centers[0] - centers[1]) <= 1, `Long mixed text misaligned: ${JSON.stringify({ textLength: text.length, centers })}`);
    long.push({ textLength: text.length, fontSize, centers });
  }
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:9000'; document.body.append(host);
  const card = document.createElement('div'); host.append(card);
  const editor = document.createElement('div'); editor.style.cssText = 'width:100%;height:100%'; host.append(editor);
  const cardRoot = createRoot(card), editorRoot = createRoot(editor), thumbnails = [];
  try {
    const source = document.createElement('canvas'); source.width = 560; source.height = 400;
    source.getContext('2d').fillRect(0, 0, 560, 400);
    const photo = { id: 'mixed-font-card', path: '', fileName: 'fixture.png', width: 560, height: 400, megapixels: .224, thumbnailDataUrl: source.toDataURL(), metadata: {} };
    for (const fontFamily of ['Allura', 'Cinzel', 'Long Cang']) for (const rotation of [0, 90, -90]) {
      const design = createDefaultDocument(); design.frame.paddingX = 0; design.frame.paddingY = 0;
      for (const region of Object.values(design.regions)) { region.enabled = false; region.extra = 0; }
      delete design.distributions; delete design.alignments;
      design.layers = [{ ...design.layers[0], id: 'signature', source: 'custom', customValue: '名字 ming 123', region: 'canvas', x: .5, y: .5, fontFamily, fontSize: 48, fontWeight: 400, color: '#fff', opacity: .7, rotation, visible: true }];
      const saved = JSON.stringify(design);
      cardRoot.render(React.createElement(TemplatePreview, { template: { id: fontFamily + rotation, cover: photo.thumbnailDataUrl, layouts: { landscape: design } }, photo }));
      editorRoot.render(React.createElement(EditorCanvas, { photo, document: design, selectedLayerIds: [], snapEnabled: false, onZoomChange() {}, onSelectionChange() {}, onLayersCommit() {} }));
      await t.waitFor(() => card.querySelector('img')?.complete, 'Template image missing');
      const { world } = await t.context(editor); await t.frame();
      const node = world.findOne('#signature');
      await t.waitFor(() => node?.findOne('Text')?.fontFamily() === library.previewFontFamily(fontFamily), 'Editor font not ready');
      const geometry = calculateGeometry(photo, design);
      const main = node.toCanvas({ x: node.x() - geometry.width / 2, y: node.y() - geometry.height / 2, width: geometry.width, height: geometry.height, pixelRatio: 560 / geometry.width });
      const thumbnail = document.createElement('canvas'); thumbnail.width = 560; thumbnail.height = 400;
      thumbnail.getContext('2d').drawImage(card.querySelector('img'), 0, 0);
      const a = bounds(main), b = bounds(thumbnail, 0, 560, true);
      t.assert(['left', 'right', 'top', 'bottom'].every(key => Math.abs(a[key] - b[key]) <= 2), `Template and editor disagree: ${JSON.stringify({ fontFamily, rotation, a, b })}`);
      t.assert(JSON.stringify(design) === saved, 'Rendering mutated the saved template');
      thumbnails.push({ fontFamily, rotation, main: a, thumbnail: b });
      // Unmount between cases to avoid observing the previous image during effects.
      cardRoot.render(null); await t.frame();
    }
    const { unicodeCmap6Font } = await import('/scripts/font-test-fixtures.js');
    const bytes = unicodeCmap6Font(await (await fetch('/fonts/spacemono/SpaceMono-Regular.ttf')).arrayBuffer());
    // Some engines reject cmap6-only fonts before our parser is reached.
    // WebKit must retain its working import/restore behavior for these fonts.
    let cmap6Supported = false;
    try { await new FontFace('Cmap6Capability', bytes).load(); cmap6Supported = true; } catch {}
    if (cmap6Supported) {
      const imported = await library.importFont(new File([bytes], 'Unicode BMP.ttf'));
      const layout = layoutWatermarkText({ fontFamily: imported.value, fontSize: 32, fontWeight: 400 }, '名字 ming123');
      t.assert(layout.runs.some(run => run.font.includes(imported.family) && run.text.includes('ming')), 'Imported cmap6 font did not render its own Latin glyphs');
      const fresh = await import('/src/font-library.ts?cmap6-restore-regression');
      await fresh.ensureFontsLoaded([imported.value]);
      t.assert(fresh.fontSnapshot().fonts.some(font => font.family === imported.family), 'Previously saved cmap6 font failed to restore');
    } else {
      let error;
      try { await library.importFont(new File([bytes], 'Unicode BMP.ttf')); } catch (caught) { error = caught; }
      t.assert(String(error).includes('无法解析字体'), 'Unsupported browser font needs an actionable error');
    }
    return { long, thumbnails, templateUnchanged: true, cmap6ImportAndRestore: cmap6Supported, browserSupportsCmap6: cmap6Supported };
  } finally { cardRoot.unmount(); editorRoot.unmount(); host.remove(); }
})();
