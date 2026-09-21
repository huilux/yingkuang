(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const getImage = () => document.querySelector('.design-canvas .preview-backdrop');
  const waitFor = async predicate => {
    const start = performance.now();
    while (!predicate() && performance.now() - start < 5000) await frame();
    if (!predicate()) throw new Error('Background cache did not become ready');
  };
  await waitFor(getImage);
  const firstUrl = getImage().getAttribute('href');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const change = (input, value) => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const zoom = document.querySelector('input[aria-label="画布缩放"]');
  change(zoom, 160); await frame();
  if (getImage()?.getAttribute('href') !== firstUrl) throw new Error('Zoom regenerated the filtered background');
  const blur = document.querySelector('input[aria-label="模糊程度"]');
  const original = Number(blur.value);
  change(blur, original + 1); await frame();
  await waitFor(() => getImage() && getImage().getAttribute('href') !== firstUrl);
  const changedUrl = getImage().getAttribute('href');
  change(blur, original + 2); await frame();
  change(blur, original + 1); await frame();
  await waitFor(() => getImage() && getImage().getAttribute('href') !== changedUrl);
  const decoded = new Image();
  decoded.src = getImage().getAttribute('href');
  await decoded.decode();
  if (Math.max(decoded.naturalWidth, decoded.naturalHeight) > 1600) throw new Error('Background bitmap is not bounded');
  change(blur, original); await frame();
  await waitFor(getImage);
  return { zoomReusedCache: true, changesInvalidatedCache: true, rapidRevertDecoded: true, width: decoded.naturalWidth, height: decoded.naturalHeight };
})();
