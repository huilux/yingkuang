// Run on a fresh browser-mode Vite page. No private photo fixture is needed.
(async () => {
  const fixture = document.createElement('canvas');
  fixture.width = 4000;
  fixture.height = 3000;
  fixture.getContext('2d').fillRect(0, 0, 4000, 3000);
  const blob = await new Promise(resolve => fixture.toBlob(resolve, 'image/png'));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], 'large-preview.png', { type: 'image/png' }));
  const input = document.querySelector('input[type=file]');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const start = performance.now();
  let preview;
  while (performance.now() - start < 5000) {
    await new Promise(resolve => setTimeout(resolve, 20));
    preview = [...document.querySelectorAll('.photo-row')].find(row => row.textContent.includes('large-preview.png'));
    if (preview) break;
  }
  if (!preview) throw new Error('Imported photo did not appear');
  const image = preview.querySelector('img');
  await image.decode();
  const report = { previewWidth: image.naturalWidth, previewHeight: image.naturalHeight, dimensions: preview.textContent };
  if (Math.max(image.naturalWidth, image.naturalHeight) > 720) throw new Error(`Full-resolution image retained in preview: ${JSON.stringify(report)}`);
  if (!preview.textContent.includes('4000 × 3000')) throw new Error('Original dimensions were lost');
  let editor;
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    editor = window.Konva.stages.find(stage => stage.container().isConnected)?.findOne('.preview-photo')?.image();
    if (editor && (editor.naturalWidth || editor.width) === 4000) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  if (!editor || (editor.naturalWidth || editor.width) !== 4000) throw new Error('Editor still displays a thumbnail instead of original detail');
  report.editorWidth = editor.naturalWidth || editor.width;
  return report;
})();
