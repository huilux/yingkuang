import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInTemplates } from '../src/editor-model.ts';
import {
  documentFromTemplate, findTemplateConflict, importTemplates,
  parseTemplateBackup, serializeTemplateBackup,
} from '../src/template-library.ts';

const builtIns = builtInTemplates();
const custom = {
  ...structuredClone(builtIns[0]),
  id: 'custom-one', name: '我的相框', builtIn: false,
};

test('backup round trip preserves layouts and selected default', () => {
  const backup = parseTemplateBackup(serializeTemplateBackup([...builtIns, custom], custom.id));
  assert.equal(backup.defaultTemplateId, custom.id);
  assert.deepEqual(backup.templates.at(-1)?.layouts, custom.layouts);
  assert.equal(backup.templates.length, 4);
});

test('malformed backup and unsupported watermark source are rejected', () => {
  assert.throws(() => parseTemplateBackup('{'), /JSON/);
  const backup = JSON.parse(serializeTemplateBackup([custom], custom.id));
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
  assert.equal(result.templates.length, 5);
  assert.equal(result.templates[0].description, '备份里的新描述');
  assert.equal(result.templates[0].builtIn, true);
  assert.equal(result.templates[1].description, builtIns[1].description);
  assert.equal(result.idMap[skipped.id], skipped.id);
  assert.equal(result.idMap[sameName.id], result.templates[4].id);
  assert.notEqual(result.templates[4].id, custom.id);
  assert.equal(result.templates[4].name, '我的相框 副本');
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
