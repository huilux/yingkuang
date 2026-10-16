// Injected fixtures come from the actual Rust renderer, not copied JS formulas.
(async () => {
  const fixtures = __FIXTURES__;
  const { rasterize } = await import('/src/use-preview-backdrop.ts');
  async function compare(name, geometry, frame, sample) {
    const actual = await rasterize(fixtures.source, frame, geometry, new AbortController().signal);
    const ref = new Image(); ref.src = fixtures[name]; await ref.decode();
    const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
    const context = canvas.getContext('2d'); context.drawImage(ref, 0, 0, canvas.width, canvas.height);
    const a = actual.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, max = 0, n = 0;
    for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
      if (!sample(x, y)) continue;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[(y * canvas.width + x) * 4 + c] - b[(y * canvas.width + x) * 4 + c]);
        sum += d; max = Math.max(max, d); n++;
      }
    }
    const result = { name, meanDifference: sum / n, maxDifference: max, samples: n };
    // WebKit quantizes its filter intermediates; allow a small bounded difference.
    if (!n || sum / n > 3 || max > 12) throw Error(JSON.stringify(result));
    return result;
  }
  const common = { color: '#ffffff', blur: 32, brightness: 75, radius: 0, shadow: 0 };
  const background = await compare('background', { width: 680, height: 580, photo: { x: 40, y: 40, width: 600, height: 400 } },
    { ...common, type: 'blur' }, (x, y) => x >= 80 && x < 600 && y >= 480 && y < 560);
  const shadow = await compare('shadow', { width: 680, height: 580, photo: { x: 80, y: 80, width: 520, height: 360 } },
    { ...common, type: 'solid', radius: 12, shadow: 40 }, (x, y) => x >= 80 && x < 600 && y >= 444 && y < 480);
  const strongShadow = await compare('strong_shadow', { width: 680, height: 580, photo: { x: 80, y: 80, width: 520, height: 360 } },
    { ...common, type: 'solid', radius: 12, shadow: 100 }, (x, y) => x >= 80 && x < 600 && y >= 444 && y < 540);
  const scaled = await compare('scaled_background', { width: 680, height: 580, photo: { x: 40, y: 40, width: 600, height: 400 } },
    { ...common, type: 'blur' }, (x, y) => x >= 80 && x < 600 && y >= 480 && y < 560);
  async function textBounds(name, rotation, fontFamily = 'LXGW WenKai TC, sans-serif', fontWeight = 400) {
    const { ensureFontsLoaded, previewFontFamily } = await import('/src/font-library.ts');
    await ensureFontsLoaded([fontFamily]);
    await document.fonts.ready;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:600px;height:400px';
    document.body.append(container);
    const stage = new window.Konva.Stage({ container, width: 600, height: 400 });
    const layer = new window.Konva.Layer();
    const node = new window.Konva.Text({ x: 300, y: 200, text: '映框 50mm f/2.8',
      fontFamily: previewFontFamily(fontFamily), fontSize: 32, fontStyle: String(fontWeight), fill: '#000', rotation });
    node.offset({ x: node.width() / 2, y: node.height() / 2 });
    layer.add(node); stage.add(layer); stage.draw();
    const preview = stage.toCanvas({ pixelRatio: 1 });
    const exported = new Image(); exported.src = fixtures[name]; await exported.decode();
    function alphaBounds(source) {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, 600, 400).data;
      let left = 600, top = 400, right = -1, bottom = -1;
      for (let y = 0; y < 400; y++) for (let x = 0; x < 600; x++) {
        if (pixels[(y * 600 + x) * 4 + 3] < 16) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1,
        centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    const result = { name, preview: alphaBounds(preview), export: alphaBounds(exported) };
    stage.destroy(); container.remove();
    const widthError = Math.abs(result.preview.width - result.export.width);
    const heightError = Math.abs(result.preview.height - result.export.height);
    const centerError = Math.hypot(result.preview.centerX - result.export.centerX, result.preview.centerY - result.export.centerY);
    if (widthError > 4 || heightError > 4 || centerError > 3) throw Error(JSON.stringify({ ...result, widthError, heightError, centerError }));
    return result;
  }
  const text = await textBounds('text', 0);
  const textRotated = await textBounds('text_rotated', 90);
  const retiredSans = await textBounds('retired_sans', 0, 'DejaVu Sans, sans-serif');
  const systemMono = await textBounds('system_mono', 0, 'monospace');
  const manrope = await textBounds('manrope_mixed', 0, 'Manrope, LXGW WenKai TC, sans-serif');
  const manropeBold = await textBounds('manrope_bold', 0, 'Manrope, LXGW WenKai TC, sans-serif', 700);
  const serif = await textBounds('serif_mixed', 0, 'Cormorant Garamond, LXGW WenKai TC, serif', 600);
  const { importFont } = await import('/src/font-library.ts');
  const fontBytes = await (await fetch('/fonts/spacemono/SpaceMono-Regular.ttf')).arrayBuffer();
  const imported = await importFont(new File([fontBytes], 'SpaceMono.ttf'));
  const importedText = await textBounds('imported_mixed', 0, imported.value);
  return { background, shadow, strongShadow, scaled, text, textRotated, retiredSans, systemMono, manrope, manropeBold, serif, importedText };
})();
