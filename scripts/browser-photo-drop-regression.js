// Run last in the browser suite: import an actual image via HTML drag events.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const root = document.querySelector('#root');
  const fixture = document.createElement('canvas'); fixture.width = 64; fixture.height = 48;
  fixture.getContext('2d').fillRect(0, 0, 64, 48);
  const blob = await new Promise(resolve => fixture.toBlob(resolve, 'image/png'));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], 'dropped-photo.PNG', { type: 'image/png', lastModified: 1 }));
  transfer.items.add(new File(['ignore'], 'notes.txt', { type: 'text/plain' }));
  const send = type => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
    root.dispatchEvent(event); return event;
  };
  const initial = root.querySelectorAll('.photo-row').length;
  send('dragenter'); await t.frame();
  t.assert(root.querySelector('.photo-drop-overlay'), 'No browser drag feedback');
  t.assert(send('dragover').defaultPrevented, 'Browser would navigate to the image');
  send('dragleave'); await t.frame();
  t.assert(!root.querySelector('.photo-drop-overlay'), 'Cancelled browser drag left overlay visible');
  t.assert(send('drop').defaultPrevented, 'Drop navigates away from editor');
  await t.waitFor(() => root.querySelectorAll('.photo-row').length === initial + 1, 'Browser drop did not import image');
  t.assert(!root.querySelector('.photo-drop-overlay'), 'Drop left overlay visible');
  t.assert([...root.querySelectorAll('.photo-row')].some(row => row.textContent.includes('64 × 48')), 'Dropped photo dimensions lost');
  send('drop'); await t.frame();
  t.assert(root.querySelectorAll('.photo-row').length === initial + 1, 'Duplicate browser drop imported twice');
  const text = new DataTransfer(); text.setData('text/plain', 'custom watermark');
  root.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: text })); await t.frame();
  t.assert(!root.querySelector('.photo-drop-overlay'), 'Internal text drag showed photo overlay');
  return { actualPhotoImported: true, navigationPrevented: true, duplicateSkipped: true, unsupportedSkipped: true, textDragIgnored: true };
})();
