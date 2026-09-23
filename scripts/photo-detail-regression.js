// Import fine two-pixel stripes through the actual application. Library images
// may be small, but the active editing texture must retain original detail.
(async () => {
  const fixture = document.createElement('canvas'); fixture.width = 3200; fixture.height = 2400;
  const ctx = fixture.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 3200, 2400);
  ctx.fillStyle = 'black'; for (let x = 0; x < 3200; x += 4) ctx.fillRect(x, 0, 2, 2400);
  const blob = await new Promise(resolve => fixture.toBlob(resolve));
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'detail-grid.png', { type: 'image/png' }));
  const input = document.querySelector('input[type=file]'); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  let bitmap;
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    const stage = window.Konva.stages.find(s => s.container().isConnected);
    bitmap = (stage?.findOne('.preview-photo') || stage?.findOne('.preview-backdrop'))?.image();
    if (bitmap && (bitmap.naturalWidth || bitmap.width) === 3200) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  if (!bitmap || (bitmap.naturalWidth || bitmap.width) !== 3200) throw Error('Original editing detail never loaded');
  const rendered = document.createElement('canvas'); rendered.width = 3200; rendered.height = 2400;
  const context = rendered.getContext('2d'); context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(1600, 1200, 100, 1).data;
  for (let x = 0; x < 100; x++) {
    const expected = x % 4 < 2 ? 0 : 255;
    if (Math.abs(pixels[x * 4] - expected) > 2) throw Error('Two-pixel original detail was blurred');
  }
  return { originalWidth: 3200, twoPixelStripesPreserved: true };
})();
