import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPhotos, selectVisiblePhotos } from '../src/photo-filter.ts';

const photos = [
  { fileName: '旅行-ＡＢＣ.JPG', width: 6000, height: 4000 },
  { fileName: '旅行-portrait.jpg', width: 4000, height: 6000 },
  { fileName: 'Square.png', width: 4000, height: 4000 },
];

test('filename and direction filters compose without changing photo records', () => {
  assert.deepEqual(filterPhotos(photos, { query: ' abc.jpg ', direction: 'all' }), [photos[0]]);
  assert.deepEqual(filterPhotos(photos, { query: '旅行', direction: 'portrait' }), [photos[1]]);
  assert.deepEqual(filterPhotos(photos, { query: '', direction: 'landscape' }), [photos[0]]);
  assert.deepEqual(filterPhotos(photos, { query: '', direction: 'square' }), [photos[2]]);
  assert.deepEqual(filterPhotos(photos, { query: 'missing', direction: 'all' }), []);
  assert.equal(photos[0].fileName, '旅行-ＡＢＣ.JPG');
});

test('visible selection actions preserve hidden choices and handle empty results', () => {
  const selected = ['hidden', 'a'];
  assert.deepEqual(selectVisiblePhotos(selected, ['a', 'b'], 'all'), ['hidden', 'a', 'b']);
  assert.deepEqual(selectVisiblePhotos(selected, ['a', 'b', 'b'], 'invert'), ['hidden', 'b']);
  assert.deepEqual(selectVisiblePhotos(selected, ['a', 'b'], 'none'), ['hidden']);
  assert.deepEqual(selectVisiblePhotos(selected, [], 'all'), selected);
  assert.deepEqual(selected, ['hidden', 'a']);
});
