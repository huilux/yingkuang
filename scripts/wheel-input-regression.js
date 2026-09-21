(async () => {
  const viewport = document.querySelector('.canvas-viewport');
  const slider = document.querySelector('input[aria-label="画布缩放"]');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const readZoom = () => Number(document.querySelector('.preview-scale').style.getPropertyValue('--preview-zoom')) * 100;
  const bounds = viewport.getBoundingClientRect();
  const reset = async () => {
    setValue.call(slider, '160');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
  };
  const wheel = deltaY => viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: bounds.left + viewport.clientWidth / 2, clientY: bounds.top + viewport.clientHeight / 2 }));
  await frame(); await frame();
  await reset();
  for (let i = 0; i < 100; i++) wheel(0.2);
  await frame();
  const fineZoom = readZoom();
  await reset(); wheel(20); await frame();
  const coarseZoom = readZoom();
  const failures = [];
  if (fineZoom >= 159.9) failures.push('Fine trackpad deltas were discarded');
  if (Math.abs(fineZoom - coarseZoom) > 0.01) failures.push('Zoom depends on how wheel deltas were divided into events');
  if (failures.length) throw new Error(JSON.stringify({ fineZoom, coarseZoom, failures }));
  return { fineZoom, coarseZoom, failures };
})();
