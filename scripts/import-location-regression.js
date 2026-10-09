// Both native import dialogs share a directory, including after remount and cancellation.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const keys = ['yingkuang-session-v2', 'yingkuang-import-directory-v1'];
  const saved = keys.map(key => localStorage.getItem(key));
  keys.forEach(key => localStorage.removeItem(key));
  const calls = [];
  const selections = [['/photos/trip/first.JPG'], null, '/photos/empty', ['/photos/next/second.png'], null];
  mockIPC((command, args) => {
    if (command === 'plugin:dialog|open') { calls.push(args.options); return selections.shift(); }
    if (command === 'list_image_files') return [];
    if (command === 'inspect_images_resilient') return { items: args.paths.map(path => ({ id: path, path, fileName: path.split('/').pop(), width: 600, height: 400, megapixels: .24, thumbnailDataUrl: '/demo.jpg', metadata: {} })), failures: [] };
  }, { shouldMockEvents: true });
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.includes(label));
  try {
    const { default: App } = await import(`/src/App.tsx?import-location=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => button('添加照片') && !button('添加照片').disabled, 'App not ready');
    button('添加照片').click();
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 1 && !button('添加照片').disabled, 'Photo not imported');
    button('导入文件夹').click(); await t.frame();
    t.assert(calls[1].defaultPath === '/photos/trip', 'Folder picker did not remember file picker directory');
    t.assert(localStorage.getItem(keys[1]) === '/photos/trip', 'Cancellation changed the saved directory');
    button('导入文件夹').click(); await t.frame();
    t.assert(localStorage.getItem(keys[1]) === '/photos/empty', 'Empty folder choice was not remembered');
    button('添加照片').click();
    await t.waitFor(() => host.querySelectorAll('.photo-row').length === 2 && !button('添加照片').disabled, 'Second photo not imported');
    t.assert(calls[3].defaultPath === '/photos/empty', 'File picker did not use the last folder');
    root.unmount(); root = createRoot(host);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => button('添加照片') && !button('添加照片').disabled, 'Restored app not ready');
    button('添加照片').click(); await t.frame();
    t.assert(calls[4].defaultPath === '/photos/next', 'Directory did not survive restarting the app');
    return { sharedDirectory: true, cancellationPreservesDirectory: true, emptyFolderRemembered: true, restartRemembered: true };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    keys.forEach((key, index) => saved[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[index]));
  }
})();
