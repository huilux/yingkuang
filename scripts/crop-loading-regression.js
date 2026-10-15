// Exercise the same lazy boundary as the app with a deterministically pending chunk.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const {default: React} = await import(moduleUrl('react'));
  const {default: {createRoot}} = await import(moduleUrl('react-dom_client'));
  const {CropLoading} = await import('/src/CropLoading.tsx');
  const {applyTheme, readThemePreference} = await import('/src/theme.ts');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const photo = {fileName: 'loading-fixture.jpg', thumbnailDataUrl: '/demo.jpg'};
  let ready, cancelled = 0;
  const Lazy = React.lazy(() => new Promise(resolve => { ready = resolve; }));
  const render = () => root.render(React.createElement(React.Suspense, {
    fallback: React.createElement(CropLoading, {photo, onCancel: () => { cancelled++; root.render(null); }})
  }, React.createElement(Lazy)));
  try {
    render(); await t.waitFor(() => host.querySelector('.crop-loading'), 'Lazy loading feedback missing');
    const dialog = host.querySelector('[role="dialog"]');
    t.assert(host.querySelector('[role="status"]').textContent.includes('正在准备裁切工具'), 'Loading status missing');
    t.assert(host.querySelector('[aria-busy="true"]'), 'Busy region missing');
    t.assert(dialog.contains(document.activeElement), 'Focus escaped loading dialog');
    const size = dialog.getBoundingClientRect();
    t.assert(size.top >= 0 && size.bottom <= innerHeight && size.left >= 0 && size.right <= innerWidth, 'Loading editor exceeds window');
    const backgrounds = [];
    for (const theme of ['light', 'dark']) {
      applyTheme(theme); await t.frame();
      backgrounds.push(getComputedStyle(dialog).backgroundColor);
    }
    t.assert(backgrounds[0] !== backgrounds[1], 'Loading feedback ignores theme');
    dialog.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    await t.frame(); t.assert(cancelled === 1 && !host.querySelector('[role="dialog"]'), 'Escape did not cancel loading');
    t.assert(document.activeElement === opener && !opener.inert, 'Loading cancellation did not restore focus');
    render(); await t.waitFor(() => host.querySelector('.crop-loading'), 'Loading did not reopen');
    ready({default: () => React.createElement('div', {'data-crop-loaded': true}, 'ready')});
    await t.waitFor(() => host.querySelector('[data-crop-loaded]'), 'Lazy completion did not replace loading feedback');
    t.assert(!host.querySelector('.crop-loading') && !opener.inert, 'Loading modal left background inert');
    return {pendingChunk: true, themedPreview: true, fitsWindow: true, escapeAndFocus: true, completion: true};
  } finally {
    root.unmount(); host.remove(); opener.remove(); applyTheme(readThemePreference());
  }
})()
