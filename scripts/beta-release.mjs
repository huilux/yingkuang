import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
async function fileHash(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'huilux/yingkuang';
const platforms = { 'linux-x64': { target: 'x86_64-unknown-linux-gnu', bundle: 'deb', extension: '.deb' }, 'windows-x64': { target: 'x86_64-pc-windows-msvc', bundle: 'nsis', extension: '.exe' } };
const run = args => {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 600000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
export function validateDraft(release, version, tag, commit) {
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version) || tag !== `v${version}`) throw new Error('Tag must match the beta version in package.json');
  if (!release.isDraft || !release.isPrerelease || release.tagName !== tag) throw new Error('Only an existing prerelease draft can receive test packages');
  if (!/^[a-f0-9]{40}$/.test(commit) || release.targetCommitish !== commit) throw new Error('Draft must target this exact full commit SHA');
}
async function validate(tag, commit) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const release = JSON.parse(run(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,isPrerelease,tagName,targetCommitish']));
  validateDraft(release, version, tag, commit);
  return version;
}
async function packagePath(platform, version) {
  const config = platforms[platform];
  if (!config) throw new Error('Unsupported beta platform');
  const directory = join(root, 'src-tauri/target/release/bundle', config.bundle);
  const names = (await readdir(directory)).filter(name => name.endsWith(config.extension) && name.includes(version));
  if (names.length !== 1) throw new Error(`Expected one ${version} installer, found ${names.length}`);
  return join(directory, names[0]);
}
async function find(directory, filename) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await find(path, filename));
    else if (entry.name === filename) found.push(path);
  }
  return found;
}
async function stage(platform, installedRoot, commit) {
  const config = platforms[platform];
  if (!config) throw new Error('Unsupported beta platform');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected the exact source commit');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const candidates = (await find(resolve(installedRoot), 'inventory.json')).filter(path => path.replaceAll('\\', '/').endsWith(`/licenses/dependencies/${config.target}/inventory.json`));
  if (candidates.length !== 1) throw new Error('Installed dependency inventory missing or ambiguous');
  const dependencies = join(root, 'test-output/licenses', config.target);
  const sourceInventory = JSON.parse(await readFile(join(dependencies, 'inventory.json'), 'utf8'));
  if (sourceInventory.target !== config.target || sourceInventory.missingTexts.length || sourceInventory.reviewRequired.length) throw new Error('Dependency license review items remain');
  const licenses = resolve(candidates[0], '../../..');
  const pairs = [[join(licenses, 'MIT.txt'), join(root, 'LICENSE')], [join(licenses, 'THIRD_PARTY_NOTICES.md'), join(root, 'THIRD_PARTY_NOTICES.md')], ...['inventory.json', 'LICENSE-TEXTS.txt'].map(name => [join(licenses, 'dependencies', config.target, name), join(dependencies, name)])];
  for (const family of await readdir(join(root, 'public/fonts'), { withFileTypes: true })) {
    if (family.isDirectory()) pairs.push([join(licenses, 'fonts', family.name, 'OFL.txt'), join(root, 'public/fonts', family.name, 'OFL.txt')]);
  }
  for (const [actual, expected] of pairs) {
    if (!(await readFile(actual)).equals(await readFile(expected))) throw new Error(`Installed license differs: ${basename(expected)}`);
  }
  const smoke = JSON.parse(await readFile(join(root, 'test-output', `beta-smoke-${platform}.json`), 'utf8'));
  if (smoke.platform !== platform || smoke.startup !== 'passed' || smoke.packageCheck !== 'passed') throw new Error('Package/startup smoke check did not pass');
  const output = join(root, 'test-output/beta', platform);
  await mkdir(output, { recursive: true });
  const prefix = `yingkuang_${version}_${platform}`;
  await copyFile(await packagePath(platform, version), join(output, prefix + config.extension));
  await copyFile(join(dependencies, 'inventory.json'), join(output, prefix + '_dependency-inventory.json'));
  let texts = '';
  for (const [, expected] of pairs) texts += `\n===== ${expected.slice(root.length).replaceAll('\\', '/')} =====\n${await readFile(expected, 'utf8')}\n`;
  await writeFile(join(output, prefix + '_LICENSES.txt'), texts);
  await writeFile(join(output, prefix + '_checks.json'), JSON.stringify({ version, commit, platform, installedLicenseFilesVerified: pairs.length, ...smoke, scope: 'Automated package/startup checks only; interactive photo editing/export and clean user environment acceptance remain pending.' }, null, 2) + '\n');
  const hashes = [];
  for (const name of (await readdir(output)).sort()) {
    if (name.endsWith('_SHA256SUMS.txt')) continue;
    hashes.push(`${createHash('sha256').update(await readFile(join(output, name))).digest('hex')}  ${name}`);
  }
  await writeFile(join(output, prefix + '_SHA256SUMS.txt'), hashes.join('\n') + '\n');
  console.log(`Verified ${pairs.length} installed license files; staged ${platform} beta materials`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate') await validate(...args);
  else if (command === 'package') console.log(await packagePath(args[0], JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version));
  else if (command === 'stage') await stage(...args);
  else if (command === 'upload-platform') {
    const [platform, tag, commit] = args;
    if (!platforms[platform]) throw new Error('Unsupported beta platform');
    const version = await validate(tag, commit);
    const directory = join(root, 'test-output/beta', platform);
    const files = (await readdir(directory)).sort().map(name => join(directory, name));
    const prefix = `yingkuang_${version}_${platform}`;
    const expected = [platforms[platform].extension, '_dependency-inventory.json', '_LICENSES.txt', '_checks.json', '_SHA256SUMS.txt'].map(suffix => prefix + suffix).sort();
    if (JSON.stringify(files.map(file => basename(file))) !== JSON.stringify(expected)) throw new Error('Unexpected private staging assets');
    run(['release', 'upload', tag, ...files, '--repo', repo, '--clobber']);
    console.log(`Staged ${platform} files privately; assembly will combine the supporting files`);
  }
  else if (command === 'upload-appimage') {
    const [tag, commit] = args;
    const version = await validate(tag, commit);
    const directory = join(root, 'test-output/beta/linux-appimage-x64');
    const prefix = `yingkuang_${version}_linux-appimage-x64`;
    const expected = [prefix + '.AppImage', prefix + '_materials.zip', prefix + '_SHA256SUMS.txt'].sort();
    const names = (await readdir(directory)).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Unexpected AppImage staging files');
    run(['release', 'upload', tag, ...names.map(name => join(directory, name)), '--repo', repo, '--clobber']);
  }
  else if (command === 'upload') {
    const [tag, commit] = args;
    const version = await validate(tag, commit);
    const directory = join(root, 'test-output/beta-release');
    const files = (await readdir(directory)).sort().map(name => join(directory, name));
    const expected = ['SHA256SUMS.txt', `yingkuang_${version}_linux-x64.deb`, `yingkuang_${version}_windows-x64.exe`, `yingkuang_${version}_release-materials.zip`, `yingkuang_${version}_linux-x64.AppImage`].sort();
    if (JSON.stringify(files.map(file => basename(file))) !== JSON.stringify(expected)) throw new Error('Expected three packages, one materials archive and one checksum file');
    const sums = new Map((await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').map(line => line.split('  ')));
    if (sums.size !== 4) throw new Error('Expected four release checksums');
    for (const file of files.filter(file => basename(file) !== 'SHA256SUMS.txt')) {
      const checksum = await fileHash(file);
      if (sums.get(checksum) !== basename(file)) throw new Error('Release checksum mismatch');
    }
    run(['release', 'upload', tag, ...files, '--repo', repo, '--clobber']);
    // Only an exact-source unpublished draft can be cleaned up; installers stay
    // byte-for-byte identical and all supporting records remain inside the ZIP.
    await validate(tag, commit);
    for (const suffix of ['.AppImage', '_materials.zip', '_SHA256SUMS.txt']) run(['release', 'delete-asset', tag, `yingkuang_${version}_linux-appimage-x64${suffix}`, '--yes', '--repo', repo]);
    for (const platform of Object.keys(platforms)) {
      for (const suffix of ['_dependency-inventory.json', '_LICENSES.txt', '_checks.json', '_SHA256SUMS.txt']) {
        run(['release', 'delete-asset', tag, `yingkuang_${version}_${platform}${suffix}`, '--yes', '--repo', repo]);
      }
    }
    const { assets } = JSON.parse(run(['release', 'view', tag, '--repo', repo, '--json', 'assets']));
    if (JSON.stringify(assets.map(asset => asset.name).sort()) !== JSON.stringify(expected)) throw new Error('Unexpected remaining draft assets');
    console.log(`Uploaded five Windows/Linux assets to draft ${tag}; draft remains unpublished`);
  } else throw new Error('Expected validate, package, stage, upload-platform or upload command');
}
