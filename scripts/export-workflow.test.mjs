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

test('retry uses the original request after selection, edits and settings change', () => {
  const mutableSettings = structuredClone(settings);
  const mutableDocuments = structuredClone(documents);
  const plan = workflow.buildExportPlan({ photos, documents: mutableDocuments, activeId: 'a', checkedIds: ['a', 'b'], settings: mutableSettings });
  const request = workflow.createExportRequest(plan.items, mutableSettings);
  mutableDocuments.b.frame.paddingX = 20;
  mutableSettings.directory = '/different';
  mutableSettings.range = 'current';
  const retry = workflow.retryExportRequest(request, new Set(['/photos/b.jpg']));
  assert.deepEqual(retry.items.map(item => item.path), ['/photos/b.jpg']);
  assert.equal(retry.items[0].document.frame.paddingX, 4);
  assert.equal(retry.settings.directory, '/output');
  retry.items[0].document.frame.paddingX = 19;
  assert.equal(request.items[1].document.frame.paddingX, 4);
});

test('oversized canvases are rejected in the export dialog', () => {
  const plan = workflow.buildExportPlan({ photos, documents, activeId: 'a', checkedIds: ['a'], settings: { ...settings, size: 'long-edge', longEdge: 30000 } });
  assert.ok(plan.issues.some(issue => issue.message.includes('像素')));
});

test('no-upscale caps the photo scale while retaining frames and the long-edge ceiling', () => {
  for (const [width, height] of [[600, 400], [400, 600], [400, 400], [2400, 1600]]) {
    const photo = { ...photos[0], width, height };
    const input = { photos: [photo], documents, activeId: 'a', checkedIds: ['a'], settings };
    const original = workflow.buildExportPlan(input);
    const fixed = workflow.buildExportPlan({ ...input, settings: { ...settings, size: 'long-edge', longEdge: 1200 } });
    const limited = workflow.buildExportPlan({ ...input, settings: { ...settings, size: 'long-edge', longEdge: 1200, noUpscale: true } });
    const originalEdge = Math.max(...original.sampleDimensions.split(' × ').map(Number));
    assert.equal(limited.sampleDimensions, originalEdge <= 1200 ? original.sampleDimensions : fixed.sampleDimensions);
    assert.equal(Math.max(...fixed.sampleDimensions.split(' × ').map(Number)), 1200);
    const unchanged = workflow.buildExportPlan({ ...input, settings: { ...settings, noUpscale: true } });
    assert.equal(unchanged.sampleDimensions, original.sampleDimensions);
  }
});

test('elapsed time reports seconds, minutes and hours without rounding up', () => {
  assert.equal(workflow.formatElapsed(999), '0 秒');
  assert.equal(workflow.formatElapsed(12500), '12 秒');
  assert.equal(workflow.formatElapsed(61000), '1 分 1 秒');
  assert.equal(workflow.formatElapsed(3661000), '1 小时 1 分 1 秒');
});
