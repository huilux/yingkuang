(async () => {
  const { assert, context, frame, waitFor } = await import('/scripts/konva-test-utils.js');
  // Earlier native mocks leave an empty internal object; this is a browser
  // fixture. Use the app's exact Vite URL to share its module instance under HMR.
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke !== 'function') delete window.__TAURI_INTERNALS__;
  const libraryUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/font-library.ts').name;
  const library = await import(libraryUrl);
  const { stage } = await context();
  await library.ensureFontsLoaded(library.builtinFonts.map(font => font.value));
  assert(library.builtinFonts.length === 8, 'Expected eight offline font families');
  for (const font of library.builtinFonts) assert(document.fonts.check(`400 32px ${library.previewFontFamily(font.value)}`), `${font.family} did not load offline`);
  document.querySelector('#tab-watermark').click(); await frame();
  document.querySelector('.layer-visibility[aria-label^="隐藏"]').closest('.layer-row').querySelector('.layer-main').click(); await frame();
  const fontSelect = () => document.querySelector('select[aria-label="字体"]');
  await waitFor(() => fontSelect() && !document.querySelector('.font-import-button').disabled, 'Font picker not ready');
  const select = value => { fontSelect().value = value; fontSelect().dispatchEvent(new Event('change', { bubbles: true })); };
  const initial = fontSelect().value;
  const montserrat = library.builtinFonts.find(font => font.family === 'Montserrat');
  select(montserrat.value); await frame();
  await waitFor(() => stage.findOne('.watermark-layer').findOne('Text').fontFamily() === library.previewFontFamily(montserrat.value), 'Canvas font did not change');
  document.querySelector('button[aria-label="撤销"]').click(); await frame();
  assert(fontSelect().value === initial, 'Font choice did not undo');
  const input = document.querySelector('input[aria-label="导入字体文件"]');
  const bytes = await (await fetch('/fonts/space-mono/SpaceMono-Regular.ttf')).arrayBuffer();
  const files = new DataTransfer();
  files.items.add(new File([new Uint8Array([0, 1, 0, 0, 1, 2])], 'Broken.TTF'));
  files.items.add(new File([bytes], 'My Caption.TTF'));
  input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !document.querySelector('.font-import-button').disabled, 'Font import did not finish', 10000);
  assert(document.querySelector('.font-feedback[role="alert"]')?.textContent.includes('Broken.TTF'), 'Invalid font needs an actionable error');
  assert(fontSelect().value === initial, 'Import changed the current layer without a font choice');
  assert(library.fontSnapshot().fonts.length === 1, 'Good font was lost after an invalid file: ' + JSON.stringify(library.fontSnapshot()) + ' / ' + document.querySelector('.font-feedback')?.textContent);
  const imported = library.fontSnapshot().fonts[0];
  select(imported.value); await frame();
  await waitFor(() => stage.findOne('.watermark-layer').findOne('Text').fontFamily() === library.previewFontFamily(imported.value), 'Imported font not applied to canvas');
  const duplicate = new DataTransfer(); duplicate.items.add(new File([bytes], 'Renamed.otf'));
  input.files = duplicate.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => !document.querySelector('.font-import-button').disabled, 'Duplicate import did not finish');
  assert(library.fontSnapshot().fonts.length === 1, 'Renamed identical bytes duplicated the font');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('yingkuang-fonts-v1', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const stored = await new Promise((resolve, reject) => {
    const request = db.transaction('fonts').objectStore('fonts').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); db.close();
  assert(stored.length === 1 && stored[0].data.byteLength === bytes.byteLength, 'Font bytes were not persisted');
  const fresh = await import('/src/font-library.ts?font-restart-regression');
  await fresh.ensureFontsLoaded([imported.value]);
  assert(fresh.fontSnapshot().fonts.some(font => font.value === imported.value), 'A fresh library did not restore the imported font');
  // Restore the initial design so later browser checks start from its baseline.
  select(initial); await frame();
  return { offlineFamilies: 8, builtinChoiceUndo: true, importedCanvasFont: true, invalidFileRecovery: true, duplicateDeduplication: true, persistedFontBytes: bytes.byteLength, freshLibraryRestore: true };
})();
