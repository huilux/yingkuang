import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from '../src/session-storage.ts';
import { createDefaultDocument } from '../src/editor-model.ts';

test('legacy partial sessions preserve documents, missing paths and manual text', () => {
  const saved = { paths: ['missing.jpg'], documentsByPath: { 'missing.jpg': createDefaultDocument() }, overridesByPath: { 'missing.jpg': { camera: '' } }, exportSettings: { directory: '/output', range: 'current' } };
  assert.deepEqual(parseSession(JSON.stringify(saved)), saved);
  assert.deepEqual(parseSession(null), { paths: [] });
});

test('malformed session structure is rejected before reaching editor state', () => {
  for (const saved of [null, [], { paths: [17] }, { documentsByPath: { 'photo.jpg': {} } }, { overridesByPath: { 'photo.jpg': { camera: 1 } } }, { exportSettings: { format: 'unknown' } }, { exportSettings: { suffixMode: 'unknown' } }, { exportSettings: { suffix: null } }, { exportSettings: { noUpscale: 'yes' } }]) {
    assert.throws(() => parseSession(JSON.stringify(saved)));
  }
  assert.throws(() => parseSession('{"paths":'));
});

test('relocation retains photo order, edits, selection, template and old dimensions without mutating the source', async () => {
  const { relocateSessionPath } = await import('../src/session-storage.ts');
  const original = { paths: ['first.jpg', 'old.jpg', 'last.jpg'], activePath: 'old.jpg', checkedPaths: ['old.jpg'],
    documentsByPath: { 'old.jpg': createDefaultDocument() }, overridesByPath: { 'old.jpg': { camera: 'Manual' } },
    templateIdsByPath: { 'old.jpg': 'wide-float' }, dimensionsByPath: { 'old.jpg': { width: 6000, height: 4000 } } };
  const next = relocateSessionPath(original, 'old.jpg', 'new.jpg');
  assert.deepEqual(next.paths, ['first.jpg', 'new.jpg', 'last.jpg']);
  assert.equal(next.activePath, 'new.jpg');
  assert.deepEqual(next.checkedPaths, ['new.jpg']);
  for (const field of ['documentsByPath', 'overridesByPath', 'templateIdsByPath', 'dimensionsByPath']) {
    assert.deepEqual(next[field]['new.jpg'], original[field]['old.jpg']);
    assert.equal(next[field]['old.jpg'], undefined);
  }
  assert.ok(original.paths.includes('old.jpg'));
  assert.throws(() => relocateSessionPath(original, 'old.jpg', 'first.jpg'));
  assert.throws(() => relocateSessionPath(original, 'absent.jpg', 'new.jpg'));
  assert.deepEqual(relocateSessionPath(original, 'old.jpg', 'old.jpg'), original);
  assert.throws(() => parseSession(JSON.stringify({ paths: [], dimensionsByPath: { 'a.jpg': { width: 0, height: 20 } } })));
});


test('invalid stored rendering parameters are retained for recovery instead of being loaded', () => {
  const document = createDefaultDocument(); document.frame.paddingX = -1;
  assert.throws(() => parseSession(JSON.stringify({ paths: ['a.jpg'], documentsByPath: { 'a.jpg': document } })), /编辑文档/);
});
