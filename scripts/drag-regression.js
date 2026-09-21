// Exercise pointer selection and dragging at an off-centre point on real layers.
(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const svg = document.querySelector('.design-canvas');
  const layer = svg.querySelector('.watermark-layer');
  const text = layer.querySelector('text');
  const snap = document.querySelector('button[aria-pressed]');
  if (snap?.getAttribute('aria-pressed') === 'true') { snap.click(); await frame(); }
  const origin = () => new DOMPoint(0, 0).matrixTransform(layer.getScreenCTM());
  const before = origin();
  const bounds = text.getBoundingClientRect();
  const x = bounds.right - 2;
  const y = (bounds.top + bounds.bottom) / 2;
  const pointer = (target, type, clientX, clientY, buttons = 1) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'mouse', button: 0, buttons, clientX, clientY }));
  // Synthetic pointer events have no OS pointer for capture; retain the real
  // React handlers and SVG coordinate conversion while stubbing only capture.
  const capture = svg.setPointerCapture;
  const release = svg.releasePointerCapture;
  svg.setPointerCapture = () => {};
  svg.releasePointerCapture = () => {};
  try {
    pointer(text, 'pointerdown', x, y);
    await frame();
    pointer(svg, 'pointermove', x + 1, y + 1);
    await frame();
    const afterClick = origin();
    const clickJump = Math.hypot(afterClick.x - before.x, afterClick.y - before.y);
    pointer(svg, 'pointermove', x + 24, y + 12);
    await frame();
    const afterDrag = origin();
    const dragError = Math.hypot(afterDrag.x - before.x - 24, afterDrag.y - before.y - 12);
    pointer(svg, 'pointerup', x + 24, y + 12, 0);
    await frame();
    const failures = [];
    if (clickJump > 0.1) failures.push(`Selection with a 1px hand tremor moved the layer ${clickJump.toFixed(2)}px`);
    if (dragError > 1) failures.push(`Off-centre drag jumped ${dragError.toFixed(2)}px away from the grabbed point`);
    const undo = document.querySelector('button[aria-label="撤销"]');
    if (undo.disabled) failures.push('Drag did not create an undo step');
    else { undo.click(); await frame(); }
    const restored = origin();
    if (Math.hypot(restored.x - before.x, restored.y - before.y) > 1) failures.push('Undo did not restore the original position');
    pointer(text, 'pointerdown', x, y);
    pointer(svg, 'pointermove', x + 20, y);
    pointer(svg, 'pointerup', x + 20, y, 0);
    await frame();
    if (undo.disabled) failures.push('Move and release before the next paint lost the undo step');
    if (failures.length) throw new Error(JSON.stringify({ clickJump, dragError, failures }));
    return { clickJump, dragError, failures };
  } finally {
    svg.setPointerCapture = capture;
    svg.releasePointerCapture = release;
  }
})();
