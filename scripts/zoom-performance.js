// Diagnostic timing only: compare the same gesture with and without live filters.
(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const svg = document.querySelector('.design-canvas');
  const frame = () => new Promise(requestAnimationFrame);
  const bounds = viewport.getBoundingClientRect();
  const cacheStart = performance.now();
  while (svg.querySelector('.preview-backdrop-source') && performance.now() - cacheStart < 5000) await frame();
  const cacheReady = !!svg.querySelector('.preview-backdrop');
  const run = async () => {
    const slider = document.querySelector('input[aria-label="画布缩放"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '100');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame(); await frame();
    const samples = [];
    let previous = await frame();
    for (let i = 0; i < 48; i++) {
      viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i < 24 ? -30 : 30, clientX: bounds.left + viewport.clientWidth / 2, clientY: bounds.top + viewport.clientHeight / 2 }));
      const now = await frame();
      samples.push(now - previous); previous = now;
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[24], p95Ms: samples[45], over32ms: samples.filter(value => value > 32).length, frames: samples.length };
  };
  const original = await run();
  const filters = [...svg.querySelectorAll('[filter]')].map(node => [node, node.getAttribute('filter')]);
  filters.forEach(([node]) => node.removeAttribute('filter'));
  await frame(); await frame();
  const withoutFilters = await run();
  filters.forEach(([node, value]) => node.setAttribute('filter', value));
  const report = { cacheReady, original, withoutFilters, canvasFilterSupported: 'filter' in document.createElement('canvas').getContext('2d') };
  if (original.p95Ms > 50) throw new Error(JSON.stringify(report));
  return report;
})();
