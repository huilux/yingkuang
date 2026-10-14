import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
};
const target = process.argv[2] ?? run('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1];
if (!target || process.argv.length > 3) throw new Error('Usage: node scripts/collect-licenses.mjs [Rust target triple]');
const metadata = JSON.parse(run('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--format-version', '1', '--filter-platform', target]));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const supplements = JSON.parse(await readFile(join(root, 'licenses/upstream/sources.json'), 'utf8'));
const packages = [];
const texts = [];
async function collect(directory, prefix = '') {
  const found = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.isSymbolicLink()) continue;
    const local = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !['node_modules', '.git', 'target'].includes(entry.name)) {
      found.push(...await collect(join(directory, entry.name), local));
    } else if (entry.isFile() && /^(licen[sc]e|copying|copyright|notice|ofl|third[-_]party[-_]licen[sc]es?|unlicense)([._-]|$)/i.test(entry.name)) {
      found.push({ file: local, text: await readFile(join(directory, entry.name), 'utf8') });
    }
  }
  return found;
}
async function add(ecosystem, name, version, license, directory, extraFile) {
  const files = await collect(directory);
  const supplementalSources = [];
  const supplement = supplements.find(entry => entry.ecosystem === ecosystem && entry.name === name && entry.version === version);
  if (supplement) {
    for (const item of supplement.files) {
      const data = await readFile(join(root, item.path));
      if (createHash('sha256').update(data).digest('hex') !== item.sha256) throw new Error(`License checksum mismatch: ${item.path}`);
      files.push({ file: item.path, text: data.toString('utf8') });
      supplementalSources.push(item.url);
    }
  }
  // Platform binding packages carry their publisher's parent package license.
  const parent = ecosystem === 'npm' && name.startsWith('@rolldown/binding-') ? 'rolldown'
    : ecosystem === 'npm' && name.startsWith('@tauri-apps/cli-') ? '@tauri-apps/cli' : null;
  if (files.length === 0 && parent) {
    const parentDir = join(root, 'node_modules', parent);
    const manifest = JSON.parse(await readFile(join(parentDir, 'package.json'), 'utf8'));
    if (manifest.version !== version) throw new Error(`Parent version mismatch: ${name}`);
    for (const item of await collect(parentDir)) files.push({ file: `${parent}/${item.file}`, text: item.text });
    supplementalSources.push(`npm:${parent}@${version}`);
  }
  if (extraFile) {
    const file = relative(directory, extraFile).replaceAll('\\', '/');
    if (!files.some(item => item.file === file)) files.push({ file, text: await readFile(extraFile, 'utf8') });
  }
  const record = { ecosystem, name, version, license, files: files.map(item => item.file), supplementalSources };
  packages.push(record);
  for (const item of files) texts.push(`===== ${ecosystem}: ${name}@${version} / ${item.file} =====\nDeclared license: ${license ?? 'UNKNOWN'}\n\n${item.text}`);
}
const absentOptional = [];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!path) continue;
  const directory = join(root, path);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || !entry.optional) throw error;
    absentOptional.push({ package: path, version: entry.version });
    continue;
  }
  if (manifest.version !== entry.version) throw new Error(`Installed version differs from lock: ${path}`);
  await add('npm', manifest.name, manifest.version, entry.license, directory);
}
for (const entry of metadata.packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))) {
  if (!entry.source) continue;
  await add('cargo', entry.name, entry.version, entry.license, dirname(entry.manifest_path), entry.license_file);
}
const missingTexts = packages.filter(entry => entry.files.length === 0).map(({ ecosystem, name, version, license }) => ({ ecosystem, name, version, license }));
const output = join(root, 'test-output', 'licenses', target);
await mkdir(output, { recursive: true });
const scope = 'Dependency-source inventory, including build/development dependencies. Not an audit or an exact linked-binary inventory. System libraries and packaging-tool payloads require separate review. Missing license texts require manual follow-up.';
await writeFile(join(output, 'inventory.json'), JSON.stringify({ target, scope, packages, absentOptional, missingTexts }, null, 2) + '\n');
await writeFile(join(output, 'LICENSE-TEXTS.txt'), `${scope}\n\n${texts.join('\n\n')}\n`);
console.log(`${packages.length} packages; ${missingTexts.length} without separate license text. Output: test-output/licenses/${target}`);
