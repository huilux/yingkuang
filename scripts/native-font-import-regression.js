(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const bytes = await (await fetch('/fonts/spacemono/SpaceMono-Regular.ttf')).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const family = 'YingkuangFont' + [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
  const font = { family, name: 'Native Caption Regular', data: btoa([...new Uint8Array(bytes)].map(v => String.fromCharCode(v)).join('')) };
  const selections = [null, ['/fonts/Broken.OTF', '/fonts/Caption.TtF']];
  const calls = [], imports = [];
  mockIPC((command, args) => {
    if (command === 'plugin:dialog|open') { calls.push(args.options); return selections.shift(); }
    if (command === 'import_font') {
      imports.push(args.path);
      if (args.path.includes('Broken')) throw new Error('字体文件损坏，请选择有效的 TTF 或 OTF');
      return font;
    }
    if (command === 'list_fonts') return { fonts: [font], errors: [] };
  });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const edits = [];
  try {
    const { FontPicker } = await import(`/src/FontPicker.tsx?native-font=${Date.now()}`);
    root.render(React.createElement(FontPicker, { value: 'LXGW WenKai TC, sans-serif', onChange: value => edits.push(value) }));
    await t.waitFor(() => host.querySelector('.font-import-button') && !host.querySelector('.font-import-button').disabled, 'Native font picker not ready');
    host.querySelector('.font-import-button').click(); await t.frame();
    t.assert(imports.length === 0 && edits.length === 0, 'Cancel imported or edited a layer');
    t.assert(calls[0].multiple && calls[0].filters[0].extensions.includes('TtF'), 'Native dialog lacks multi-select or mixed-case TTF filter');
    host.querySelector('.font-import-button').click();
    await t.waitFor(() => imports.length === 2 && !host.querySelector('.font-import-button').disabled, 'Native multi-font import did not finish');
    t.assert(host.querySelector('.font-feedback[role="alert"]').textContent.includes('Broken.OTF'), 'Native parse failure not reported');
    t.assert([...host.querySelectorAll('option')].some(option => option.value.startsWith(family)), 'Native imported face missing from picker');
    t.assert(edits.length === 0, 'Native import patched a layer before choosing a font');
    const fresh = await import(`/src/font-library.ts?native-font-restart=${Date.now()}`);
    await fresh.restoreImportedFonts();
    t.assert(fresh.fontSnapshot().fonts.some(item => item.family === family), 'Native restart did not restore font data from Rust');
    t.assert(fresh.fontSnapshot().errors.length === 0, 'Native font restoration reported an error');
    return { nativeMultiFileDialog: true, cancellationPreservesDocument: true, uppercaseExtensions: true, partialFailureRecovery: true, nativeFontLoaded: true, nativeRestartRestore: true };
  } finally { root.unmount(); host.remove(); clearMocks(); }
})();
