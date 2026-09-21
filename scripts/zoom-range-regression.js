// Sweep the real slider through both sides of the viewport overflow threshold.
(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.querySelector('.design-canvas');
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await frame();
  await frame();
  const failures = [];
  const samples = [];
  const values = [40, 60, 80, 100, 140, 180, 220, 180, 140, 100, 80, 60, 40, 20, 40];
  for (const zoom of values) {
    setValue.call(slider, String(zoom));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    const view = viewport.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const fitsX = rect.width + 80 <= viewport.clientWidth;
    const fitsY = rect.height + 80 <= viewport.clientHeight;
    const driftX = rect.left + rect.width / 2 - view.left - viewport.clientWidth / 2;
    const driftY = rect.top + rect.height / 2 - view.top - viewport.clientHeight / 2;
    const excessX = viewport.scrollWidth - viewport.clientWidth;
    const excessY = viewport.scrollHeight - viewport.clientHeight;
    samples.push({ zoom: slider.value, driftX, driftY, excessX, excessY, fitsX, fitsY });
    if (fitsX && (excessX > 1 || Math.abs(driftX) > 1.5)) failures.push(`At ${zoom}% a fitting canvas has horizontal overflow/offset`);
    if (fitsY && (excessY > 1 || Math.abs(driftY) > 1.5)) failures.push(`At ${zoom}% a fitting canvas has vertical overflow/offset`);
  }
  if (failures.length) throw new Error(JSON.stringify({ failures, samples }));
  return { failures, samples: samples.length };
})();
