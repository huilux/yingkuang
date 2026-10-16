// Test backup-before-write, quota failure, concurrent changes and resumed persistence.
(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const url = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(url('react'));
  const { default: { createRoot } } = await import(url('react-dom_client'));
  const sessionKey = 'yingkuang-session-v2', templatesKey = 'yingkuang-templates-v3';
  const previous = new Map([sessionKey, templatesKey, 'yingkuang-templates-v2', 'yingkuang-templates-v1'].map(key => [key, localStorage.getItem(key)]));
  const originalSet = Storage.prototype.setItem;
  const reports = [];
  try {
    for (const scope of ['session', 'templates', 'previous', 'legacy']) {
      let checkpoint=0;
      const waitFor=(predicate,message='')=>t.waitFor(predicate, `${scope} checkpoint ${++checkpoint}: ${message}`);
      const key = scope === 'session' ? sessionKey : templatesKey;
      const rawKey = scope === 'legacy' ? 'yingkuang-templates-v1' : scope === 'previous' ? 'yingkuang-templates-v2' : key;
      let raw = '{broken-' + scope;
      localStorage.setItem(sessionKey, scope === 'session' ? raw : '{"paths":[]}');
      if (scope === 'templates') localStorage.setItem(templatesKey, raw); else localStorage.removeItem(templatesKey);
      localStorage.removeItem('yingkuang-templates-v1');
      localStorage.removeItem('yingkuang-templates-v2');
      if (scope === 'legacy' || scope === 'previous') localStorage.setItem(rawKey, raw);
      let savePath = null, failBackup = false, resolveWrite, quota = false;
      let photoSelection = ['current.jpg'];
      const backups = [];
      Storage.prototype.setItem = function(name, value) {
        if (quota && name === key) throw new DOMException('Full', 'QuotaExceededError');
        return originalSet.call(this, name, value);
      };
      mockIPC((command, args) => {
        if (command === 'plugin:dialog|open') return photoSelection;
        if (command === 'plugin:dialog|save') return savePath;
        if (command === 'write_template_backup') {
          if (failBackup) throw Error('Disk full');
          backups.push(JSON.parse(args.content));
          return new Promise(resolve => { resolveWrite = resolve; });
        }
        if (command === 'inspect_images_resilient') return { items: args.paths.map(path => ({ id: path, path, fileName: path, width: 600, height: 400, megapixels: .24, thumbnailDataUrl: '/demo.jpg', metadata: {} })), failures: [] };
      }, { shouldMockEvents: true });
      const host = document.createElement('div'); document.body.append(host);
      let root = createRoot(host);
      const button = label => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === label);
      const modal = () => host.querySelector('.storage-recovery-dialog');
      const openRecovery = async () => {
        host.querySelector('.storage-notice button').click();
        await waitFor(modal);
      };
      const duplicate = async () => {
        button('模板库').click(); await waitFor(() => host.querySelector('.template-manager'));
        host.querySelector('[aria-label^="复制"]').click(); await t.frame();
        host.querySelector('[aria-label="关闭模板库"]').click(); await t.frame();
      };
      try {
        const { default: App } = await import(`/src/App.tsx?storage-recovery=${scope}-${Date.now()}`);
        root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await waitFor(() => host.querySelector('.storage-notice button:not(:disabled)'));
        host.querySelector('.library-import-actions button').click(); await waitFor(() => host.querySelector('.photo-row'));
        if (scope !== 'session') await duplicate();
        t.assert(localStorage.getItem(rawKey) === raw, 'Editing replaced the unreadable original before backup');
        await openRecovery();
        t.assert(button('恢复自动保存').disabled, 'Recovery was enabled without a backup');
        button('备份原始记录').click(); await t.frame();
        t.assert(button('恢复自动保存').disabled && localStorage.getItem(rawKey) === raw, 'Cancelling backup enabled recovery');
        savePath = '/backup/recovery.json'; failBackup = true;
        button('备份原始记录').click(); await waitFor(() => modal().querySelector('[role="alert"]'));
        t.assert(button('恢复自动保存').disabled && localStorage.getItem(rawKey) === raw, 'Failed backup altered original');
        failBackup = false;
        button('备份原始记录').click(); await waitFor(() => resolveWrite);
        t.assert(button('恢复自动保存').disabled, 'Recovery enabled before write completed');
        resolveWrite(); resolveWrite = null;
        await waitFor(() => !button('恢复自动保存').disabled);
        t.assert(backups.at(-1).originalRecords[rawKey] === raw, 'Backup changed the raw original');
        const candidate = JSON.parse(backups.at(-1).currentRecords[key]);
        t.assert(scope === 'session' ? candidate.paths.includes('current.jpg') : candidate.custom.length === 1, 'Backup omitted current edits');
        // A concurrent writer must not be overwritten even after a successful backup.
        raw = '{changed-in-another-window'; originalSet.call(localStorage, rawKey, raw);
        button('恢复自动保存').click(); await t.frame();
        t.assert(modal().textContent.includes('原记录已改变') && localStorage.getItem(rawKey) === raw, 'Concurrent change was overwritten');
        button('取消').click(); await t.frame();
        await openRecovery(); button('备份原始记录').click(); await waitFor(() => resolveWrite);
        resolveWrite(); resolveWrite = null; await waitFor(() => !button('恢复自动保存').disabled);
        const beforeQuota = localStorage.getItem(key);
        quota = true; button('恢复自动保存').click(); await t.frame();
        t.assert(modal().textContent.includes('尚未恢复') && localStorage.getItem(rawKey) === raw, 'Quota failure destroyed original');
        t.assert(localStorage.getItem(key) === beforeQuota, 'Quota failure partially replaced the target record');
        quota = false; button('恢复自动保存').click(); await waitFor(() => !modal());
        t.assert(!host.querySelector('.storage-notice'), 'Successful recovery left a stale storage error');
        if (scope === 'session') {
          photoSelection = ['later.jpg']; host.querySelector('.library-import-actions button').click();
          await waitFor(() => JSON.parse(localStorage.getItem(key)).paths.includes('later.jpg'), 'Session did not resume automatic saving');
        } else {
          await duplicate();
          await waitFor(() => JSON.parse(localStorage.getItem(key)).custom.length === 2, 'Templates did not resume automatic saving');
        }
        root.unmount(); root = createRoot(host); root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
        await waitFor(() => host.querySelectorAll('.photo-row').length === (scope === 'session' ? 2 : 1)); await t.frame();
        t.assert(!host.querySelector('.storage-notice'), 'Recovered records failed to load after restart');
        t.assert(backups.at(-1).originalRecords[rawKey] === raw, 'Latest backup did not retain the changed original');
        reports.push({ scope, rawBackupPreserved: true, cancelledAndFailedBackupSafe: true, pendingWriteBlocked: true,
          concurrentChangeBlocked: true, quotaSafe: true, automaticSaveResumed: true, restartRecovered: true });
      } finally { resolveWrite?.(); root.unmount(); host.remove(); clearMocks(); Storage.prototype.setItem = originalSet; }
    }
    return reports;
  } finally {
    Storage.prototype.setItem = originalSet;
    for (const [key, value] of previous) if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  }
})();
