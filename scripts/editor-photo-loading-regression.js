// Exercise native loading, stale completion and error fallback independently
// of photo inspection; import/export commands have their own integration tests.
(async () => {
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { useEditorPhoto } = await import('/src/use-editor-photo.ts');
  const { waitFor, frame } = await import('/scripts/konva-test-utils.js');
  const fixture = document.createElement('canvas'); fixture.width = 64; fixture.height = 40;
  const thumbnailDataUrl = fixture.toDataURL();
  fixture.width = 3200; fixture.height = 200;
  const high = fixture.toDataURL('image/jpeg', 0.92);
  const pending = new Map(), requests = [];
  mockIPC((command, args) => {
    if (command !== 'load_editor_photo') throw Error(`Unexpected command ${command}`);
    requests.push(args.path);
    return new Promise((resolve, reject) => pending.set(args.path, { resolve, reject }));
  });
  let current;
  function Probe({ photo }) { current = useEditorPhoto(photo); return null; }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const photo = id => ({ id, path: id, thumbnailDataUrl, width: 3200, height: 200, metadata: {} });
  const render = id => root.render(React.createElement(React.StrictMode, null, React.createElement(Probe, { photo: photo(id) })));
  try {
    render('A'); await waitFor(() => pending.has('A'), 'A never requested');
    // IPC starts immediately after setImage, before React necessarily commits it.
    // Keep the original pending and assert the visible fallback after that commit.
    await waitFor(() => current.image?.width === 64 && current.loading, 'Thumbnail was not shown while loading');
    render('B'); await waitFor(() => pending.has('B'), 'B never requested');
    pending.get('B').resolve(high);
    await waitFor(() => current.image?.width === 3200 && !current.loading, 'B original detail not shown');
    const chosen = current.image;
    pending.get('A').resolve(thumbnailDataUrl); await frame(); await frame();
    if (current.image !== chosen) throw Error('Late A image replaced B');
    render('B'); await frame();
    if (requests.join(',') !== 'A,B') throw Error(`Unnecessary original reload: ${requests}`);
    render('missing'); await waitFor(() => pending.has('missing'));
    pending.get('missing').reject('File unavailable');
    await waitFor(() => current.error && !current.loading);
    if (current.image?.width !== 64) throw Error('Missing original removed the usable fallback');
    return { staleCompletionIgnored: true, noDuplicateRequests: true, visibleErrorFallback: true };
  } finally { root.unmount(); host.remove(); clearMocks(); }
})();
