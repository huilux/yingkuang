(async () => {
  const t = await import('/scripts/konva-test-utils.js');
  const { mockIPC, clearMocks } = await import('/node_modules/@tauri-apps/api/mocks.js');
  const moduleUrl = name => performance.getEntriesByType('resource').find(entry => entry.name.includes(`/deps/${name}.js?`)).name;
  const { default: React } = await import(moduleUrl('react'));
  const { default: { createRoot } } = await import(moduleUrl('react-dom_client'));
  const { builtInTemplates } = await import('/src/editor-model.ts');
  const {bundledCatalog}=await import('/src/builtin-template-catalog.ts');
  const { serializeTemplateBackup } = await import('/src/template-library.ts');
  const templates = builtInTemplates();
  const incoming = [1, 2].map(index => ({ ...structuredClone(templates[0]), id: `incoming-${index}`, name: `导入边界 ${index}`, builtIn: false }));
  const valid = serializeTemplateBackup(incoming, incoming[0].id);
  const invalid = JSON.parse(valid);
  invalid.templates[1].layouts.landscape.frame.paddingX = -1;
  let content = JSON.stringify(invalid);
  const imports = [];
  mockIPC(command => command === 'plugin:dialog|open' ? '/tmp/template-backup.json' : command === 'read_template_backup' ? content : undefined);
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:1000'; document.body.append(host);
  const root = createRoot(host);
  const button = text => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === text);
  try {
    const { TemplateManager } = await import(`/src/TemplateManager.tsx?template-import=${Date.now()}`);
    root.render(React.createElement(TemplateManager, {
      templates, defaultTemplateId: templates[0].id,officialCatalog:bundledCatalog(),overrideBases:{},
      updates:{native:false,current:{version:'2026.10.1',revision:1},previousVersion:null,candidate:null,busy:false,message:'',error:'',ready:true,canApply:true,check(){},install(){},importPackage(){},rollback(){}},
      onClose() {}, onDefaultChange() {}, onRename() {}, onDuplicate() {}, onDelete() {}, onReset() {},
      onImport: (...args) => imports.push(args),
    }));
    await t.waitFor(() => button('导入备份'), 'Template manager did not mount');
    button('导入备份').click();
    await t.waitFor(() => host.querySelector('[role="alert"]')?.textContent.includes('第 2 个模板'), 'Invalid template was not identified');
    t.assert(!host.querySelector('.template-import-list') && imports.length === 0, 'Invalid backup reached import confirmation');
    t.assert(host.querySelectorAll('.template-manager-row').length === templates.length, 'Rejected backup changed the library');
    content = valid;
    button('导入备份').click();
    await t.waitFor(() => button('确认导入'), 'Valid backup cannot be retried after failure');
    t.assert(!button('确认导入').disabled && !host.querySelector('[role="alert"]'), 'Valid backup retains an error');
    button('确认导入').click(); await t.frame();
    t.assert(imports.length === 1 && imports[0][0].length === 2, 'Valid backup was not imported exactly once');
    t.assert(imports[0][0].every(decision => decision.choice === 'copy') && imports[0][1] === incoming[0].id && imports[0][2], 'Import choices or default changed');
    return { invalidIndexReported: 2, invalidBackupPreservedLibrary: true, validRetryImported: 2 };
  } finally { root.unmount(); host.remove(); clearMocks(); }
})();
