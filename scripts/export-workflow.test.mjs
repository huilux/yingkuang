import test from 'node:test';
import assert from 'node:assert/strict';
import * as workflow from '../src/export-workflow.ts';

const photos = [
  { id: 'a', path: '/photos/a.jpg', fileName: 'a.jpg', width: 6000, height: 4000, metadata: {} },
  { id: 'b', path: '/photos/b.jpg', fileName: 'b.jpg', width: 4000, height: 6000, metadata: {} },
];
const documents = {
  a: { frame: { paddingX: 4, paddingY: 4 }, regions: { top: { enabled: false, extra: 0 }, bottom: { enabled: true, extra: 12 }, left: { enabled: false, extra: 0 }, right: { enabled: false, extra: 0 } }, layers: [] },
  b: { frame: { paddingX: 4, paddingY: 4 }, regions: { top: { enabled: false, extra: 0 }, bottom: { enabled: true, extra: 12 }, left: { enabled: false, extra: 0 }, right: { enabled: false, extra: 0 } }, layers: [] },
};
const settings = {
  directory: '/output', format: 'jpeg', quality: 92, size: 'original', longEdge: 6000,
  metadata: 'basic', includeGps: false, range: 'selected', suffix: '-相框',
  collision: 'number', pngCompression: 'standard',
};

test('export plan freezes the selected photo documents and supports retry filtering', () => {
  const plan = workflow.buildExportPlan({ photos, documents, activeId: 'a', checkedIds: ['a', 'b'], settings });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].path, '/photos/a.jpg');
  assert.equal(plan.sampleFileName, 'a-相框.jpg');
  assert.match(plan.sampleDimensions, /^\d+ × \d+$/);
  const retry = workflow.buildExportPlan({ photos, documents, activeId: 'a', checkedIds: ['a', 'b'], settings, retryPaths: new Set(['/photos/b.jpg']) });
  assert.deepEqual(retry.items.map(item => item.path), ['/photos/b.jpg']);
});

test('client validation blocks invalid dimensions, unsafe suffixes, missing folders and empty ranges', () => {
  const invalid = workflow.buildExportPlan({
    photos,
    documents,
    activeId: 'a',
    checkedIds: [],
    settings: { ...settings, directory: '', size: 'long-edge', longEdge: 0, suffix: '../../escape' },
  });
  assert.deepEqual(invalid.issues.map(issue => issue.field), ['range', 'directory', 'longEdge', 'suffix']);
});

test('an intentionally empty suffix matches the backend filename behavior', () => {
  const plan = workflow.buildExportPlan({ photos, documents, activeId: 'a', checkedIds: ['a'], settings: { ...settings, suffix: '' } });
  assert.equal(plan.sampleFileName, 'a.jpg');
  assert.equal(plan.issues.length, 0);
});
