import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedImportDirectory } from '../src/import-location.ts';

test('file selection remembers the containing directory across desktop path formats', () => {
  for (const [path, directory] of [
    ['/photos/trip/IMG.JPG', '/photos/trip'], ['/IMG.JPG', '/'],
    ['C:\\照片\\IMG.JPG', 'C:\\照片'], ['C:\\IMG.JPG', 'C:\\'],
    ['C:/IMG.JPG', 'C:/'], ['\\\\server\\share\\IMG.JPG', '\\\\server\\share'],
  ]) assert.equal(selectedImportDirectory([path, '/other/second.jpg'], 'files'), directory);
  assert.equal(selectedImportDirectory([], 'files'), undefined);
  assert.equal(selectedImportDirectory('IMG.JPG', 'files'), undefined);
});

test('folder selection remembers the chosen folder itself, including roots', () => {
  for (const directory of ['/photos/trip', '/', 'C:\\', '\\\\server\\share']) {
    assert.equal(selectedImportDirectory(directory, 'folder'), directory);
  }
});
