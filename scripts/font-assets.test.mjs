import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const catalog = JSON.parse(readFileSync(new URL('../src/font-catalog.json', import.meta.url), 'utf8'));
const sources = JSON.parse(readFileSync(new URL('../public/fonts/sources.json', import.meta.url), 'utf8'));
const assets = new Map(sources.files.map(file => [file.file, file]));

test('only the six selected offline families are bundled in preview, native export and notices', () => {
  assert.deepEqual(catalog.map(font => font.family), ['Cormorant Garamond', 'Allura', 'Long Cang', 'Sacramento', 'Cinzel', 'Space Mono']);
  const files = catalog.flatMap(font => font.files.map(file => file.path));
  const folders = [...new Set(files.map(file => file.split('/')[0]))].sort();
  assert.deepEqual(readdirSync(new URL('../public/fonts/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), folders);
  const native = readFileSync(new URL('../src-tauri/src/fonts.rs', import.meta.url), 'utf8');
  assert.deepEqual([...native.matchAll(/include_bytes!\(\s*"\.\.\/\.\.\/public\/fonts\/([^\"]+)"\s*\)/g)].map(match => match[1]).sort(), [...files].sort());
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(config.bundle.resources).filter(path => path.startsWith('../public/fonts/')).sort(), folders.map(folder => `../public/fonts/${folder}/OFL.txt`));
  assert.deepEqual([...assets.keys()].sort(), [...files, ...folders.map(folder => `${folder}/OFL.txt`)].sort());
  const bytes = files.reduce((total, path) => total + readFileSync(new URL(`../public/fonts/${path}`, import.meta.url)).length, 0);
  assert.ok(bytes <= 7 * 1024 * 1024, `Offline fonts exceed the 7 MiB budget: ${bytes}`);
});

test('saved retired family names resolve directly to an available offline replacement', () => {
  const retired = JSON.parse(readFileSync(new URL('../src/retired-fonts.json', import.meta.url), 'utf8'));
  const families = new Set(catalog.map(font => font.family));
  for (const [old, replacement] of Object.entries(retired)) {
    assert.ok(!families.has(old) && families.has(replacement), `${old} -> ${replacement} must resolve without a missing-font chain`);
  }
});

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
