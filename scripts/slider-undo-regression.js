// A range input has no text editing undo; keep editor undo available while focused.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const root = document.querySelector('#root');
  const undo = root.querySelector('button[aria-label="撤销"]');
  const redo = root.querySelector('button[aria-label="重做"]');
  const shortcut = (input, key, shiftKey = false, metaKey = false) => {
    const event = new KeyboardEvent('keydown', {key, ctrlKey:!metaKey, metaKey, shiftKey, bubbles:true, cancelable:true});
    input.dispatchEvent(event);
    return event;
  };
  async function check(label) {
    const input = root.querySelector(`input[aria-label="${label}"]`);
    t.assert(input, `${label} slider missing`);
    const original = Number(input.value);
    const direction = original <= Number(input.max) - 3 ? 1 : -1;
    const key = direction > 0 ? 'ArrowRight' : 'ArrowLeft';
    let changed = false;
    try {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true}));
      for (let step = 1; step <= 3; step++) {
        t.change(input, original + direction * step);
        await t.frame();
      }
      input.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true}));
      await t.frame();
      changed = true;
      t.assert(Number(input.value) === original + direction * 3, `${label} adjustment missing`);
      const event = shortcut(input, 'z'); await t.frame();
      t.assert(Number(input.value) === original, `${label}: focused Ctrl+Z did not undo the complete adjustment`);
      changed = false;
      t.assert(event.defaultPrevented, `${label}: editor shortcut escaped to browser`);
      shortcut(input, 'z', true); await t.frame(); changed = true;
      t.assert(Number(input.value) === original + direction * 3, `${label}: Ctrl+Shift+Z did not redo`);
      shortcut(input, 'z'); await t.frame(); changed = false;
      shortcut(input, 'y'); await t.frame(); changed = true;
      t.assert(Number(input.value) === original + direction * 3, `${label}: Ctrl+Y did not redo`);
      shortcut(input, 'z', false, true); await t.frame(); changed = false;
      t.assert(Number(input.value) === original, `${label}: Cmd+Z did not undo`);
      shortcut(input, 'z', true, true); await t.frame(); changed = true;
      t.assert(Number(input.value) === original + direction * 3, `${label}: Cmd+Shift+Z did not redo`);
      undo.click(); await t.frame(); changed = false;
      t.assert(Number(input.value) === original, `${label}: button undo changed behavior`);
      redo.click(); await t.frame(); changed = true;
      undo.click(); await t.frame(); changed = false;
    } finally {
      input.blur();
      if (changed) { undo.click(); await t.frame(); }
    }
  }
  root.querySelector('#tab-frame').click(); await t.frame();
  await check('模糊程度');
  root.querySelector('#tab-watermark').click(); await t.frame();
  root.querySelector('.layer-main').click(); await t.frame();
  await check('字号');
  await check('透明度');
  const coordinate = root.querySelector('input[aria-label="X 坐标"]');
  coordinate.focus();
  t.assert(!shortcut(coordinate, 'z').defaultPrevented, 'Editor intercepted numeric text undo');
  coordinate.blur(); await t.frame();
  root.querySelector('#tab-frame').click(); await t.frame();
  const before = root.querySelector('input[aria-label="模糊程度"]').value;
  [...root.querySelectorAll('button')].find(button => button.textContent.includes('导出当前')).click();
  await t.frame();
  const quality = root.querySelector('input[aria-label="JPEG 质量"]');
  // A previous flow may have saved PNG. Choose JPEG for the modal guard check.
  if (!quality) {
    const format = [...root.querySelectorAll('.export-dialog label')].find(label => label.textContent.startsWith('格式')).querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(format, 'jpeg');
    format.dispatchEvent(new Event('change', {bubbles:true})); await t.frame();
  }
  const exportSlider = root.querySelector('input[aria-label="JPEG 质量"]');
  exportSlider.focus();
  t.assert(!shortcut(exportSlider, 'y').defaultPrevented, 'Export modal let editor redo run in background');
  t.assert(root.querySelector('input[aria-label="模糊程度"]').value === before, 'Export modal changed background document');
  root.querySelector('[data-export-close]').click(); await t.frame();
  return {focusedRangeUndo:true,redoShortcuts:true,gestureGrouped:true,textUndoPreserved:true,modalGuard:true};
})();
