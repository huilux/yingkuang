import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const jsonPaths = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'];
const documents = jsonPaths.map(path => ({ path, value: JSON.parse(read(path)) }));
const cargoPath = 'src-tauri/Cargo.toml';
const lockPath = 'src-tauri/Cargo.lock';
const cargo = read(cargoPath);
const lock = read(lockPath);
const packagePattern = /(\[package\]\s*\nname = "yingkuang"\s*\nversion = ")([^"]+)(")/;
const lockPattern = /(\[\[package\]\]\s*\nname = "yingkuang"\s*\nversion = ")([^"]+)(")/;
if (!packagePattern.test(cargo) || !lockPattern.test(lock)) throw new Error('Cannot find application version in Cargo files');
const requested = process.argv[2];
if (requested) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested)) throw new Error('Expected a semantic version such as 0.1.1');
  for (const { path, value } of documents) {
    value.version = requested;
    if (path === 'package-lock.json') value.packages[''].version = requested;
    writeFileSync(new URL(path, root), JSON.stringify(value, null, 2) + '\n');
  }
  writeFileSync(new URL(cargoPath, root), cargo.replace(packagePattern, (_, prefix, _old, suffix) => `${prefix}${requested}${suffix}`));
  writeFileSync(new URL(lockPath, root), lock.replace(lockPattern, (_, prefix, _old, suffix) => `${prefix}${requested}${suffix}`));
}
const versions = [
  ...jsonPaths.map(path => [path, JSON.parse(read(path)).version]),
  ['package-lock.json packages[""]', JSON.parse(read('package-lock.json')).packages[''].version],
  [cargoPath, read(cargoPath).match(packagePattern)[2]],
  [lockPath, read(lockPath).match(lockPattern)[2]],
];
if (new Set(versions.map(([, version]) => version)).size !== 1) {
  throw new Error(`Application versions disagree: ${JSON.stringify(versions)}`);
}
console.log(`${requested ? 'Updated' : 'Verified'} application version ${versions[0][1]} in ${fileURLToPath(root)}`);
