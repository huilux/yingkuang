// Browser integration helpers: use Konva's public scene API for observations,
// but drive user actions through DOM mouse/wheel/input events.
export const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
export const assert = (condition, message) => { if (!condition) throw new Error(message); };
// Export/batch tests need editable custom text regardless of published styles.
export function withBrandFixture(document) {
  if (!document.layers.some(layer => layer.id === 'brand')) document.layers.unshift({
    ...document.layers[0], id:'brand', name:'品牌文字', source:'custom', customValue:'LUMIX', visible:true,
    fontFamily:'Space Mono', fontSize:24, x:.5, y:1/3,
  });
  return document;
}
export const near = (actual, expected, message, tolerance = 0.5) => assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
export async function waitFor(predicate, message = 'Timed out', timeout = 5000) {
  const start = performance.now();
  while (!predicate() && performance.now() - start < timeout) await frame();
  assert(predicate(), message);
}
export async function context(root = document) {
  await waitFor(() => root.querySelector('.konvajs-content canvas'), 'Konva canvas missing');
  const viewport = root.querySelector('.design-canvas');
  const stage = window.Konva.stages.find(stage => viewport.contains(stage.container()));
  assert(stage, 'Konva stage missing');
  await frame();
  return { root, viewport, stage, world: stage.findOne('.objects-world'), content: stage.content,
    slider: root.querySelector('input[aria-label="画布缩放"]') };
}
export function change(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
export async function zoom(ctx, value) { change(ctx.slider, value); await frame(); }
export function wheel(ctx, options = {}) {
  const rect = ctx.viewport.getBoundingClientRect();
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true,
    clientX: rect.left + ctx.stage.width() / 2, clientY: rect.top + ctx.stage.height() / 2, ...options });
  ctx.viewport.dispatchEvent(event);
  assert(event.defaultPrevented, 'Wheel input escaped to the WebView');
}
export function mouse(target, type, point, buttons = 1) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: point.x, clientY: point.y, view: window }));
}
export function screen(ctx, node, point = { x: 0, y: 0 }) {
  const local = node.getAbsoluteTransform().point(point);
  const rect = ctx.viewport.getBoundingClientRect();
  return { x: local.x + rect.left, y: local.y + rect.top };
}
export async function centerNode(ctx, node) {
  const point = node.getAbsolutePosition();
  wheel(ctx, { deltaX: point.x - ctx.stage.width() / 2, deltaY: point.y - ctx.stage.height() / 2 });
  await frame();
}
export async function disableSnap(ctx) {
  const button = ctx.root.querySelector('.canvas-toolbar button[aria-pressed]');
  if (button.getAttribute('aria-pressed') === 'true') { button.click(); await frame(); }
}
export async function fit(ctx) {
  ctx.root.querySelector('.fit-button').click();
  await frame();
}

export async function canvasCheck() {
  const ctx = await context();
  await fit(ctx);
  const background = ctx.stage.findOne('.background-world');
  const rect = background.findOne('Rect');
  near(background.x() + rect.width() * background.scaleX() / 2, ctx.stage.width() / 2, 'Fit horizontal center');
  near(background.y() + rect.height() * background.scaleY() / 2, ctx.stage.height() / 2, 'Fit vertical center');
  assert(ctx.stage.getLayers().length === 3, 'Unexpected backing canvas count');
  assert(ctx.world.clipWidth() === rect.width() && ctx.world.clipHeight() === rect.height(), 'Watermarks no longer clip to the document');
  for (const value of [20, 100, 300]) {
    await zoom(ctx, value);
    near(ctx.stage.width(), ctx.viewport.clientWidth, 'Stage width grew with zoom');
    near(ctx.stage.height(), ctx.viewport.clientHeight, 'Stage height grew with zoom');
    assert(ctx.viewport.scrollWidth === ctx.viewport.clientWidth && ctx.viewport.scrollHeight === ctx.viewport.clientHeight, 'Zoom introduced DOM scrolling');
  }
  await fit(ctx);
  assert([...ctx.root.querySelectorAll('button')].some(button => button.textContent.includes('导出当前')), 'Export entry disappeared');
  return { fixedViewport: true, clipped: true, layers: 3 };
}

export async function zoomCheck() {
  const ctx = await context();
  await zoom(ctx, 80);
  const rect = ctx.viewport.getBoundingClientRect();
  const clientX = Math.round(rect.left + ctx.stage.width() * 0.63);
  const clientY = Math.round(rect.top + ctx.stage.height() * 0.44);
  const pointer = { x: clientX - rect.left, y: clientY - rect.top };
  const anchor = ctx.world.getAbsoluteTransform().copy().invert().point(pointer);
  let maxDrift = 0;
  for (let step = 0; step < 60; step++) {
    wheel(ctx, { ctrlKey: true, deltaY: step < 30 ? -24 : 24, clientX: rect.left + pointer.x, clientY: rect.top + pointer.y });
    await frame();
    const current = ctx.world.getAbsoluteTransform().point(anchor);
    maxDrift = Math.max(maxDrift, Math.hypot(current.x - pointer.x, current.y - pointer.y));
  }
  assert(maxDrift < 0.1, `Pointer zoom drift: ${maxDrift}`);
  near(Number(ctx.slider.value), 80, 'Wheel round trip zoom', 0.01);
  const before = ctx.world.getAbsoluteTransform().copy().invert().point({ x: ctx.stage.width() / 2, y: ctx.stage.height() / 2 });
  for (const value of [20, 300, 40, 180, 80]) await zoom(ctx, value);
  const center = ctx.world.getAbsoluteTransform().point(before);
  near(center.x, ctx.stage.width() / 2, 'Slider anchor x', 0.01);
  near(center.y, ctx.stage.height() / 2, 'Slider anchor y', 0.01);
  for (let i = 0; i < 100; i++) wheel(ctx, { ctrlKey: true, deltaY: 0.2 });
  await frame();
  const fine = Number(ctx.slider.value);
  await zoom(ctx, 80); wheel(ctx, { ctrlKey: true, deltaY: 20 }); await frame();
  near(Number(ctx.slider.value), fine, 'Tiny trackpad input was lost', 0.001);
  wheel(ctx, { ctrlKey: true, deltaX: 10, deltaY: 0 }); await frame();
  near(Number(ctx.slider.value), fine, 'Horizontal wheel changed zoom', 0.001);
  for (const [delta, expected] of [[-100000, 300], [100000, 10]]) {
    wheel(ctx, { ctrlKey: true, deltaY: delta }); await frame();
    await waitFor(() => Math.abs(Number(ctx.slider.value) - expected) < 0.001, `Zoom readout did not settle at ${expected}`);
    near(Number(ctx.slider.value), expected, 'Zoom limit', 0.001);
  }
  const x = ctx.world.x(), y = ctx.world.y();
  wheel(ctx, { deltaX: 17, deltaY: 23 }); await frame();
  near(ctx.world.x(), x - 17, 'Trackpad pan x'); near(ctx.world.y(), y - 23, 'Trackpad pan y');
  await fit(ctx);
  return { maxDrift, fineInputPreserved: true, sliderRoundTrip: true, zoomLimits: true, pan: true };
}

export async function dragCheck(root = document) {
  const ctx = await context(root);
  await disableSnap(ctx);
  await waitFor(() => ctx.stage.findOne('.preview-backdrop'), 'Background not ready');
  const node = ctx.world.findOne('.watermark-layer');
  let maxDragError = 0;
  let backgroundDraws = 0;
  ctx.stage.getLayers()[0].on('draw.regression', () => backgroundDraws++);
  for (const value of [40, 100, 200, 300]) {
    await zoom(ctx, value); await centerNode(ctx, node);
    const before = screen(ctx, node);
    const grab = screen(ctx, node, { x: node.findOne('Text').width() / 2 - 3, y: 0 });
    backgroundDraws = 0;
    mouse(ctx.content, 'mousedown', grab); await frame();
    mouse(window, 'mousemove', { x: grab.x + 1, y: grab.y + 1 }); await frame();
    near(screen(ctx, node).x, before.x, 'Click tremor moved watermark', 0.01);
    const readout = root.querySelector('.coordinate-readout')?.textContent;
    for (const [dx, dy] of [[8, 4], [16, 8], [24, 12]]) {
      mouse(window, 'mousemove', { x: grab.x + dx, y: grab.y + dy }); await frame();
      const moved = screen(ctx, node);
      maxDragError = Math.max(maxDragError, Math.hypot(moved.x - before.x - dx, moved.y - before.y - dy));
      assert(root.querySelector('.coordinate-readout')?.textContent === readout, 'Drag wrote transient positions into the document');
    }
    assert(backgroundDraws === 0, `Dragging redrew the background ${backgroundDraws} times`);
    const frozenScale = ctx.world.scaleX();
    wheel(ctx, { ctrlKey: true, deltaY: -80 }); await frame();
    near(ctx.world.scaleX(), frozenScale, 'Zoom changed coordinates during drag', 1e-9);
    mouse(window, 'mouseup', { x: grab.x + 24, y: grab.y + 12 }, 0); await frame();
    assert(root.querySelector('.coordinate-readout')?.textContent !== readout, 'Drag end did not commit');
    const undo = root.querySelector('button[aria-label="撤销"]');
    assert(!undo.disabled, 'Drag did not create an undo step');
    undo.click(); await frame();
    const restored = screen(ctx, node);
    near(restored.x, before.x, 'Undo x', 0.01); near(restored.y, before.y, 'Undo y', 0.01);
  }
  assert(maxDragError < 0.1, `Off-centre drag error ${maxDragError}`);
  // Move and release in the same task, before the next paint.
  await zoom(ctx, 100); await centerNode(ctx, node);
  const initial = node.position();
  const start = screen(ctx, node);
  mouse(ctx.content, 'mousedown', start);
  mouse(window, 'mousemove', { x: start.x + 20, y: start.y });
  mouse(window, 'mouseup', { x: start.x + 20, y: start.y }, 0);
  await frame();
  assert(node.x() !== initial.x, 'Fast drag was lost');
  root.querySelector('button[aria-label="撤销"]').click(); await frame();
  near(node.x(), initial.x, 'Fast drag undo', 0.001);
  // Escape cancels without adding an undo entry.
  mouse(ctx.content, 'mousedown', start);
  mouse(window, 'mousemove', { x: start.x + 20, y: start.y }); await frame();
  ctx.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  mouse(window, 'mouseup', { x: start.x + 20, y: start.y }, 0); await frame();
  near(node.x(), initial.x, 'Escape did not restore drag origin', 0.001);
  ctx.stage.getLayers()[0].off('.regression');
  await fit(ctx);
  return { maxDragError, scales: [40, 100, 200, 300], transientDocumentWrites: 0, backgroundDrawsDuringDrag: 0, fastUndo: true, escape: true };
}

export async function cacheCheck() {
  const ctx = await context();
  const bitmap = () => ctx.stage.findOne('.preview-backdrop')?.image();
  await waitFor(bitmap, 'Background not ready');
  const first = bitmap();
  await zoom(ctx, 160);
  assert(bitmap() === first, 'Zoom rebuilt background pixels');
  // Return inspector to frame settings after any preceding drag test.
  [...document.querySelectorAll('.inspector-tabs button')].find(button => button.textContent.includes('相框'))?.click();
  await frame();
  const blur = document.querySelector('input[aria-label="模糊程度"]');
  assert(blur, 'Blur control missing');
  const original = Number(blur.value);
  change(blur, original + 1);
  await waitFor(() => bitmap() !== first, 'Frame change did not invalidate background');
  const second = bitmap();
  change(blur, original + 2); await frame(); change(blur, original + 1);
  // Rapid reversion can reuse the still-displayed bitmap or produce a fresh one;
  // either way it must finish with the requested pixels, with no revoked URL.
  await new Promise(resolve => setTimeout(resolve, 300));
  await frame();
  assert(bitmap(), 'Rapid revert lost the bitmap');
  assert(Math.max(bitmap().width, bitmap().height) <= 1600, 'Unbounded background bitmap');
  const bytes = image => image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  const actual = bytes(bitmap()), expected = bytes(second);
  assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), 'Stale background overwrote a rapid revert');
  change(blur, original); await waitFor(() => bitmap() !== second, 'Background did not restore');
  await fit(ctx);
  return { zoomReusedCache: true, rapidRevert: true, boundedBitmap: true };
}

export async function performanceCheck() {
  const ctx = await context();
  await waitFor(() => ctx.stage.findOne('.preview-backdrop'), 'Background not ready');
  await zoom(ctx, 100);
  const raf = () => new Promise(requestAnimationFrame);
  const run = async () => {
    const samples = [];
    let previous = await raf();
    for (let i = 0; i < 48; i++) {
      wheel(ctx, { ctrlKey: true, deltaY: i < 24 ? -30 : 30 });
      const now = await raf(); samples.push(now - previous); previous = now;
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[24], p95Ms: samples[45], over32ms: samples.filter(value => value > 32).length, frames: samples.length };
  };
  const cold = await run(), warm = await run();
  assert(cold.p95Ms <= 50 && warm.p95Ms <= 50, JSON.stringify({ cold, warm }));
  return { cold, warm };
}

export async function editingCheck() {
  const ctx = await context();
  await disableSnap(ctx); await zoom(ctx, 100);
  let node = ctx.world.findOne('.watermark-layer');
  await centerNode(ctx, node);
  let start = screen(ctx, node);
  mouse(ctx.content, 'mousedown', start); mouse(window, 'mouseup', start, 0); await frame();
  const undo = () => ctx.root.querySelector('button[aria-label="撤销"]').click();
  const rotate = [...ctx.root.querySelectorAll('button')].find(button => button.textContent === '右转');
  assert(rotate, 'Rotation control missing');
  rotate.click(); await frame();
  near(node.rotation(), 90, 'Rotation did not reach canvas');
  const before = screen(ctx, node);
  start = screen(ctx, node, { x: -node.findOne('Text').width() / 4, y: 0 });
  mouse(ctx.content, 'mousedown', start);
  mouse(window, 'mousemove', { x: start.x + 18, y: start.y + 6 }); await frame();
  const moved = screen(ctx, node);
  near(moved.x - before.x, 18, 'Rotated drag x'); near(moved.y - before.y, 6, 'Rotated drag y');
  mouse(window, 'mouseup', { x: start.x + 18, y: start.y + 6 }, 0); await frame();
  undo(); await frame(); undo(); await frame();
  const y = node.y();
  ctx.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); await frame();
  near(node.y(), y - 1, 'Keyboard nudge'); undo(); await frame();
  ctx.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })); await frame();
  near(node.y(), y + 10, 'Shift keyboard nudge'); undo(); await frame();
  const id = node.id();
  ctx.root.querySelector('.layer-main[aria-pressed="true"]').parentElement.querySelector('.layer-visibility').click(); await frame();
  assert(!ctx.world.findOne(n => n.id() === id), 'Hidden layer is still rendered/hit-testable');
  undo(); await frame(); node = ctx.world.findOne(n => n.id() === id);
  assert(node, 'Undo did not restore hidden layer');
  ctx.root.querySelector('.canvas-toolbar button[aria-pressed]').click(); await frame();
  await zoom(ctx, 100); await centerNode(ctx, node);
  const center = ctx.world.clipWidth() / 2;
  const target = ctx.world.getAbsoluteTransform().point({ x: center, y: node.y() });
  const rect = ctx.viewport.getBoundingClientRect();
  start = screen(ctx, node);
  mouse(ctx.content, 'mousedown', start);
  mouse(window, 'mousemove', { x: rect.left + target.x + 5, y: start.y }); await frame();
  near(node.x(), center, 'Center snapping failed', 0.01);
  assert(ctx.stage.findOne('.guide-x').visible(), 'Snap guide missing');
  mouse(window, 'mouseup', { x: rect.left + target.x + 5, y: start.y }, 0); await frame();
  undo(); await frame(); await fit(ctx);
  return { rotatedDrag: true, keyboard: true, visibility: true, snapping: true };
}
