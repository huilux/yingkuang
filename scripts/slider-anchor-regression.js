(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.querySelector('.design-canvas');
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const setZoom = async value => {
    setValue.call(slider, String(value));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
  };
  await frame(); await frame();
  await setZoom(180);
  viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) * 0.4;
  viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) * 0.4;
  await frame();
  const view = viewport.getBoundingClientRect();
  const rect = canvas.getBoundingClientRect();
  const x = view.left + viewport.clientWidth / 2;
  const y = view.top + viewport.clientHeight / 2;
  const anchor = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
  const samples = [];
  for (const value of [182,184,186,188,190,192,194,196,198,200,202,204,202,200,198,196,194,192,190,188,186,184,182,180]) {
    await setZoom(value);
    const after = canvas.getBoundingClientRect();
    samples.push({ zoom: slider.value, drift: Math.hypot(after.left + anchor.x * after.width - x, after.top + anchor.y * after.height - y) });
  }
  const maxDrift = Math.max(...samples.map(sample => sample.drift));
  if (maxDrift > 2) throw new Error(JSON.stringify({ maxDrift, samples }));
  return { maxDrift, samples: samples.length };
})();
