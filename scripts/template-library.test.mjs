import test from 'node:test';
import assert from 'node:assert/strict';
import catalogSource from '../src/data/builtin-templates.json' with { type: 'json' };
import { builtInTemplates, createDefaultDocument } from '../src/editor-model.ts';
import { builtInDefaultTemplateId, builtInTemplateChanges, isBuiltInModified, parseBuiltInCatalog, serializeBuiltInCatalog } from '../src/builtin-template-catalog.ts';
import {
  documentFromTemplate, findTemplateConflict, importTemplates,
  parseTemplateBackup, readTemplates, readTemplateLibrary, serializeTemplateBackup, serializeUserTemplates, templatesKey,
} from '../src/template-library.ts';

const builtIns = builtInTemplates();
const custom = {
  ...structuredClone(builtIns[0]),
  id: 'custom-one', name: '我的相框', builtIn: false,
};

test('project JSON supplies built-in templates and the default editor layout', () => {
  assert.equal(parseBuiltInCatalog(catalogSource).defaultTemplateId, builtInDefaultTemplateId());
  assert.deepEqual(builtInTemplates(), catalogSource.templates);
  const defaultTemplate = builtIns.find((template) => template.id === catalogSource.defaultTemplateId);
  assert.deepEqual(createDefaultDocument(), defaultTemplate.layouts.landscape ?? defaultTemplate.layouts.portrait);
  const changedSource = structuredClone(catalogSource);
  changedSource.templates[0].layouts.landscape.frame.paddingX += 3;
  assert.equal(parseBuiltInCatalog(changedSource).templates[0].layouts.landscape.frame.paddingX, changedSource.templates[0].layouts.landscape.frame.paddingX);
  changedSource.defaultTemplateId = 'missing';
  assert.throws(() => parseBuiltInCatalog(changedSource), /默认模板/);
});

test('a full template backup explains why it cannot replace the published catalog', () => {
  const backup = JSON.parse(serializeTemplateBackup([...builtIns, custom], builtIns[0].id));
  assert.throws(() => parseBuiltInCatalog(backup), /导出备份.*导出内置文件/);
});

test('published catalog exports edited built-ins without local photo covers', () => {
  const edited = structuredClone(builtIns);
  edited[0].name = '新的出厂模板';
  edited[0].cover = 'data:image/png;base64,aGVsbG8=';
  edited[0].layouts.landscape.frame.paddingX += 4;
  const exported = parseBuiltInCatalog(JSON.parse(serializeBuiltInCatalog([...edited, custom], edited[0].id)));
  assert.equal(exported.templates.length, builtIns.length);
  assert.equal(exported.templates[0].name, '新的出厂模板');
  assert.equal(exported.templates[0].cover, builtIns[0].cover);
  assert.equal(exported.templates[0].layouts.landscape.frame.paddingX, edited[0].layouts.landscape.frame.paddingX);
  assert.equal(exported.templates[0].updatedAt, 0);
  assert.throws(() => serializeBuiltInCatalog(edited, custom.id), /内置模板/);
});

test('built-in differences identify changed values by orientation and layer without exposing image data', () => {
  const edited = structuredClone(builtIns[0]);
  edited.updatedAt = Date.now();
  assert.deepEqual(builtInTemplateChanges(edited), []);
  edited.name = '我的版本';
  edited.cover = 'data:image/png;base64,aGVsbG8=';
  edited.layouts.landscape.frame.paddingX += 2;
  edited.layouts.landscape.regions.top.enabled = true;
  edited.layouts.landscape.layers.reverse();
  edited.layouts.portrait.layers[0].fontSize += 4;
  edited.layouts.portrait.layers.push({ ...edited.layouts.portrait.layers[0], id: 'new-layer', name: '新图层' });
  const changes = builtInTemplateChanges(edited);
  assert.equal(isBuiltInModified(edited), true);
  assert.ok(changes.some((change) => change.group === '基本信息' && change.field === '模板名称' && change.localValue === '我的版本'));
  assert.ok(changes.some((change) => change.group === '横图 · 相框' && change.field === '左右留白' && change.builtInValue === '4' && change.localValue === '6'));
  assert.ok(changes.some((change) => change.group === '横图 · 顶部区域' && change.field === '启用' && change.localValue === '开启'));
  assert.ok(changes.some((change) => change.group === '横图 · 水印图层' && change.field === '图层顺序'));
  assert.ok(changes.some((change) => change.group.startsWith('竖图 · 水印「') && change.field === '字号'));
  assert.ok(changes.some((change) => change.group === '竖图 · 水印图层' && change.field === '「新图层」' && change.localValue === '已添加'));
  assert.ok(changes.some((change) => change.field === '预览封面' && change.localValue === '本机照片封面'));
  assert.equal(JSON.stringify(changes).includes('aGVsbG8='), false);

  edited.layouts.portrait = undefined;
  assert.ok(builtInTemplateChanges(edited).some((change) => change.group === '竖图布局' && change.localValue === '无'));
});

test('local storage preserves only changed built-ins and migrates untouched legacy snapshots', () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null };
  try {
    const edited = structuredClone(builtIns[0]);
    edited.name = '本机修改';
    edited.updatedAt = Date.now();
    const serialized = JSON.parse(serializeUserTemplates([edited, ...builtIns.slice(1), custom]));
    assert.deepEqual(serialized.overrides.map((template) => template.id), [edited.id]);
    assert.deepEqual(serialized.custom.map((template) => template.id), [custom.id]);
    values.set(templatesKey, JSON.stringify(serialized));
    assert.equal(readTemplates()[0].name, '本机修改');

    values.delete(templatesKey);
    const oldSnapshot = structuredClone(builtIns);
    oldSnapshot[1].name = '旧版本中的修改';
    oldSnapshot[1].updatedAt = Date.now();
    values.set('yingkuang-templates-v1', JSON.stringify([...oldSnapshot, custom]));
    const migrated = readTemplates();
    assert.deepEqual(migrated[0], builtIns[0]);
    assert.equal(migrated[1].name, '旧版本中的修改');
    assert.equal(migrated.at(-1).id, custom.id);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('backup round trip preserves layouts and selected default', () => {
  const backup = parseTemplateBackup(serializeTemplateBackup([...builtIns, custom], custom.id));
  assert.equal(backup.defaultTemplateId, custom.id);
  assert.deepEqual(backup.templates.at(-1)?.layouts, custom.layouts);
  assert.equal(backup.templates.length, builtIns.length + 1);
});

test('malformed backup and unsupported watermark source are rejected', () => {
  assert.throws(() => parseTemplateBackup('{'), /JSON/);
  const backup = JSON.parse(serializeTemplateBackup([custom], custom.id));
  backup.templates[0].layouts.landscape.layers[0].source = 'exposureBias';
  assert.equal(parseTemplateBackup(JSON.stringify(backup)).templates[0].layouts.landscape.layers[0].source, 'exposureBias');
  backup.templates[0].layouts.landscape.layers[0].source = 'exif:BodySerialNumber';
  assert.equal(parseTemplateBackup(JSON.stringify(backup)).templates[0].layouts.landscape.layers[0].source, 'exif:BodySerialNumber');
  backup.templates[0].layouts.landscape.layers[0].source = 'unsupported';
  assert.throws(() => parseTemplateBackup(JSON.stringify(backup)), /字段/);
  backup.templates[0].layouts.landscape.layers[0].source = 'custom';
  backup.defaultTemplateId = 'missing';
  assert.throws(() => parseTemplateBackup(JSON.stringify(backup)), /默认模板/);
});

test('each conflict can be overwritten, copied, or skipped independently', () => {
  const changedBuiltIn = { ...structuredClone(builtIns[0]), description: '备份里的新描述' };
  const sameName = { ...structuredClone(custom), id: 'another-id', description: '同名模板的新内容' };
  const skipped = { ...structuredClone(builtIns[1]), description: '不导入的内容' };
  assert.equal(findTemplateConflict([...builtIns, custom], sameName)?.id, custom.id);
  const result = importTemplates([...builtIns, custom], [
    { template: changedBuiltIn, conflictId: builtIns[0].id, choice: 'overwrite' },
    { template: sameName, conflictId: custom.id, choice: 'copy' },
    { template: skipped, conflictId: builtIns[1].id, choice: 'skip' },
  ]);
  assert.equal(result.imported, 2);
  assert.equal(result.templates.length, builtIns.length + 2);
  assert.equal(result.templates[0].description, '备份里的新描述');
  assert.equal(result.templates[0].builtIn, true);
  assert.equal(result.templates[1].description, builtIns[1].description);
  assert.equal(result.idMap[skipped.id], skipped.id);
  assert.equal(result.idMap[sameName.id], result.templates.at(-1).id);
  assert.notEqual(result.templates.at(-1).id, custom.id);
  assert.equal(result.templates.at(-1).name, '我的相框 副本');
});

test('new photo receives a separate copy of the matching orientation layout', () => {
  const template = structuredClone(custom);
  template.layouts.portrait.frame.color = '#123456';
  const photo = { width: 800, height: 1200 };
  const document = documentFromTemplate(template, photo);
  assert.equal(document.frame.color, '#123456');
  document.frame.color = '#abcdef';
  assert.equal(template.layouts.portrait.frame.color, '#123456');
});

test('copying a maximum length name produces a unique restorable template', () => {
  const existing = { ...structuredClone(custom), name: '框'.repeat(120) };
  const result = importTemplates([existing], [{ template: existing, conflictId: existing.id, choice: 'copy' }]);
  const backup = serializeTemplateBackup(result.templates, existing.id);
  assert.doesNotThrow(() => parseTemplateBackup(backup));
  assert.ok(result.templates[1].name.length <= 120);
  assert.notEqual(result.templates[1].name, existing.name);
});

test('invalid templates cannot be silently written into the local library', () => {
  const invalid = { ...structuredClone(custom), name: 'x'.repeat(121) };
  assert.throws(() => serializeUserTemplates([invalid]), /名称|模板/);
});


test('unreadable library blocks automatic persistence instead of discarding records', () => {
  const previous = globalThis.localStorage;
  try {
    for (const raw of ['{broken', JSON.stringify({ version: 2, overrides: [], custom: [{ ...custom, name: 'x'.repeat(121) }] })]) {
      globalThis.localStorage = { getItem: key => key === templatesKey ? raw : null };
      const result = readTemplateLibrary();
      assert.equal(result.canPersist, false);
      assert.match(result.issue, /原始记录已保留/);
      assert.ok(result.templates.length >= builtIns.length);
    }
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
});

test('misplaced or duplicate template records cannot be silently normalized away', () => {
  const previous = globalThis.localStorage;
  try {
    for (const saved of [
      { version: 2, overrides: [custom], custom: [] },
      { version: 2, overrides: [], custom: [builtIns[0]] },
      { version: 2, overrides: [], custom: [custom, custom] },
      { version: 2, overrides: [{ ...builtIns[0], id: 'unknown-builtin' }], custom: [] },
    ]) {
      globalThis.localStorage = { getItem: key => key === templatesKey ? JSON.stringify(saved) : null };
      const result = readTemplateLibrary();
      assert.equal(result.canPersist, false);
      assert.doesNotThrow(() => serializeUserTemplates(result.templates));
    }
    assert.throws(() => serializeUserTemplates([...builtIns, custom, custom]), /重复/);
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
});

test('import rejects values that native export cannot render', () => {
  const changes = [
    document => { document.frame.paddingX = -1; },
    document => { document.frame.blur = 201; },
    document => { document.frame.color = '#fff'; },
    document => { document.regions.bottom.extra = 101; },
    document => { document.layers[0].fontSize = 0; },
    document => { document.layers[0].fontSize = 1001; },
    document => { document.layers[0].opacity = 2; },
    document => { document.layers[0].color = 'red'; },
    document => { document.layers.push(structuredClone(document.layers[0])); },
  ];
  for (const change of changes) {
    const template = structuredClone(custom);
    change(template.layouts.landscape);
    assert.throws(() => parseTemplateBackup(serializeTemplateBackup([template], template.id)), /字段|范围|重复/);
  }
});

test('supported native boundary values remain importable', () => {
  const template = structuredClone(custom);
  const document = template.layouts.landscape;
  Object.assign(document.frame, { blur: 200, brightness: 200, paddingX: 100, paddingY: 100, radius: 100, shadow: 100, color: '#ABCDEF' });
  document.regions.bottom.extra = 100;
  Object.assign(document.layers[0], { fontSize: 1000, opacity: 1, color: '#abcdef', x: -0.25, y: 1.25 });
  assert.doesNotThrow(() => parseTemplateBackup(serializeTemplateBackup([template], template.id)));
  document.layers[0].fontSize = 1; document.layers[0].opacity = 0;
  assert.doesNotThrow(() => parseTemplateBackup(serializeTemplateBackup([template], template.id)));
});
