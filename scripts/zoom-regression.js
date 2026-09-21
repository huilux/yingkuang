// Run against the development page with agent-browser eval --stdin.
(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.querySelector('.design-canvas');
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const style = document.querySelector('.preview-scale').style;
  const baseWidth = parseFloat(style.getPropertyValue('--preview-base-width'));
  const baseHeight = canvas.getBoundingClientRect().height / Number(style.getPropertyValue('--preview-zoom'));
  const startZoom = Math.min(280, Math.max(160, Math.ceil(Math.max((viewport.clientWidth + 200) / baseWidth, (viewport.clientHeight + 200) / baseHeight) * 100)));
  // The initial auto-fit effect can still be pending immediately after load.
  for (let attempt = 0; attempt < 5; attempt++) {
    setValue.call(slider, String(startZoom));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    if (Number(slider.value) === startZoom) break;
  }
  if (Number(slider.value) !== startZoom) throw new Error('Unable to establish the zoom baseline');
  viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
  viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  await frame();
  const bounds = viewport.getBoundingClientRect();
  const clientX = bounds.left + viewport.clientWidth / 2 + 30;
  const clientY = bounds.top + viewport.clientHeight / 2 + 20;
  const before = canvas.getBoundingClientRect();
  const initial = { zoom: slider.value, style: document.querySelector('.preview-scale').getAttribute('style'), viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight, canvas: before.toJSON(), scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, scrollWidth: viewport.scrollWidth, scrollHeight: viewport.scrollHeight };
  const anchor = { x: (clientX - before.left) / before.width, y: (clientY - before.top) / before.height };
  const failures = [];
  let maxDrift = 0;
  const driftSamples = [];
  for (let step = 0; step < 12; step++) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -40, clientX, clientY });
    viewport.dispatchEvent(event);
    if (!event.defaultPrevented && !failures.includes('Ctrl+wheel default action was not cancelled')) {
      failures.push('Ctrl+wheel default action was not cancelled');
    }
    await frame();
    const after = canvas.getBoundingClientRect();
    const drift = { x: after.left + anchor.x * after.width - clientX, y: after.top + anchor.y * after.height - clientY };
    driftSamples.push({ ...drift, scrollLeft: viewport.scrollLeft, maxLeft: viewport.scrollWidth - viewport.clientWidth });
    maxDrift = Math.max(maxDrift, Math.hypot(drift.x, drift.y));
  }
  if (maxDrift > 2) failures.push(`Zoom anchor drifted ${maxDrift.toFixed(2)}px`);
  const zoom = slider.value;
  viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 0, deltaX: 10, clientX, clientY }));
  await frame();
  if (slider.value !== zoom) failures.push('Horizontal-only wheel changed zoom');
  const ordinaryWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 20 });
  viewport.dispatchEvent(ordinaryWheel);
  if (ordinaryWheel.defaultPrevented) failures.push('Ordinary scrolling was blocked');
  const report = { maxDrift, failures };
  if (failures.length) throw new Error(JSON.stringify({ ...report, initial, driftSamples }));
  return report;
})();
