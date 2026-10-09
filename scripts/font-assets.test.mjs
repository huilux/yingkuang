import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const catalog = JSON.parse(readFileSync(new URL('../src/font-catalog.json', import.meta.url), 'utf8'));
const sources = JSON.parse(readFileSync(new URL('../public/fonts/sources.json', import.meta.url), 'utf8'));
const assets = new Map(sources.files.map(file => [file.file, file]));

test('offline fonts ship complete files and redistributable licenses at a pinned source revision', () => {
  assert.match(sources.revision, /^[0-9a-f]{40}$/);
  for (const font of catalog) for (const file of font.files) {
    for (const path of [file.path, `${file.path.split('/')[0]}/OFL.txt`]) {
      const asset = assets.get(path);
      assert.ok(asset, `Missing provenance for ${path}`);
      assert.ok(asset.source.startsWith(`https://raw.githubusercontent.com/google/fonts/${sources.revision}/ofl/`));
      const bytes = readFileSync(new URL(`../public/fonts/${path}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${path} changed`);
      if (path.endsWith('.ttf')) assert.ok(bytes.length > 1000 && bytes.length <= 32 * 1024 * 1024);
      else assert.match(bytes.toString(), /SIL OPEN FONT LICENSE/i);
    }
  }
});
