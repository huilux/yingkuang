(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.querySelector('.design-canvas');
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await frame(); await frame();
  const baseWidth = parseFloat(document.querySelector('.preview-scale').style.getPropertyValue('--preview-base-width'));
  const startZoom = Math.max(20, Math.min(240, (viewport.clientWidth - 80) / baseWidth * 100 - 12));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(startZoom));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await frame();
  const view = viewport.getBoundingClientRect();
  const clientX = view.left + viewport.clientWidth / 2 + 40;
  const clientY = view.top + viewport.clientHeight / 2;
  const before = canvas.getBoundingClientRect();
  const photoX = (clientX - before.left) / before.width;
  const samples = [];
  let last = clientX;
  let maxBacktrack = 0;
  for (let i = 0; i < 16; i++) {
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -12, clientX, clientY }));
    await frame();
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + photoX * rect.width;
    maxBacktrack = Math.max(maxBacktrack, last - x);
    samples.push({ x, zoom: slider.value, scrollLeft: viewport.scrollLeft });
    last = x;
  }
  if (maxBacktrack > 1.5) throw new Error(JSON.stringify({ maxBacktrack, samples }));
  return { maxBacktrack, samples: samples.length };
})();
