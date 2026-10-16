(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { readTemplates } = await import('/src/template-library.ts');
  const initialCount = readTemplates().filter(template => template.builtIn).length;
  const keys = ['yingkuang-session-v2', 'yingkuang-templates-v3', 'yingkuang-templates-v1', 'yingkuang-default-template-v1'];
  const saved = keys.map(key => [key, localStorage.getItem(key)]);
  keys.forEach(key => localStorage.removeItem(key));
  localStorage.setItem(keys[0], JSON.stringify({ paths: ['template-photo.jpg'], activePath: 'template-photo.jpg' }));
  mockIPC(command => command === 'inspect_images_resilient' ? {
    items: [{ id: 'template-photo', path: 'template-photo.jpg', fileName: 'template-photo.jpg', width: 6000, height: 4000, megapixels: 24, thumbnailDataUrl: '/demo.jpg', metadata: {} }], failures: [],
  } : undefined, { shouldMockEvents: true });
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:1000'; document.body.append(host);
  let root = createRoot(host);
  const button = text => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === text);
  try {
    const { default: App } = await import(`/src/App.tsx?template-save=${Date.now()}`);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
    await t.waitFor(() => button('另存为模板'), 'Restored photo is missing');
    button('另存为模板').focus(); button('另存为模板').click(); await t.frame();
    const input = host.querySelector('.compact-dialog input');
    t.assert(input.maxLength === 120, 'Template input has no matching length limit');
    t.change(input, 'x'.repeat(121)); await t.frame();
    t.assert(button('保存模板').disabled, 'Oversized template name was accepted');
    const name = '边界名称'.repeat(30);
    t.change(input, name); await t.frame(); button('保存模板').click(); await t.frame();
    t.assert(readTemplates().some(template => template.name === name), 'Saved maximum-length name cannot be read');
    button('模板库').click(); await t.frame();
    host.querySelector(`button[aria-label="复制 ${name}"]`).click(); await t.frame();
    const beforeRestart = readTemplates().filter(template => !template.builtIn);
    t.assert(beforeRestart.length === 2 && beforeRestart.every(template => template.name.length <= 120), 'Copy creates an unreadable template name');
    root.unmount(); root = createRoot(host); root.render(React.createElement(App));
    await t.waitFor(() => button('模板库'), 'Editor did not remount');
    button('模板库').click(); await t.frame();
    t.assert(host.querySelectorAll('.template-manager-row').length === initialCount + 2, 'Restart lost saved templates');
    return { maxLengthSaved: true, invalidLengthBlocked: true, copyRestored: true, templatesAfterRestart: initialCount + 2 };
  } finally {
    root.unmount(); host.remove(); clearMocks();
    saved.forEach(([key, value]) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
  }
})();
