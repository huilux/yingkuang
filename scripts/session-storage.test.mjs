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
  for (const saved of [null, [], { paths: [17] }, { documentsByPath: { 'photo.jpg': {} } }, { overridesByPath: { 'photo.jpg': { camera: 1 } } }, { exportSettings: { format: 'unknown' } }, { exportSettings: { suffix: null } }, { exportSettings: { noUpscale: 'yes' } }]) {
    assert.throws(() => parseSession(JSON.stringify(saved)));
  }
  assert.throws(() => parseSession('{"paths":'));
});
