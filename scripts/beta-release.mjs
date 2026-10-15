import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'huilux/yingkuang';
const platforms = { 'linux-x64': { target: 'x86_64-unknown-linux-gnu', bundle: 'deb', extension: '.deb' }, 'windows-x64': { target: 'x86_64-pc-windows-msvc', bundle: 'nsis', extension: '.exe' } };
const run = args => {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 60000 });
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
  else if (command === 'upload') {
    const [platform, tag, commit] = args;
    await validate(tag, commit);
    const directory = join(root, 'test-output/beta', platform);
    const files = (await readdir(directory)).sort().map(name => join(directory, name));
    if (files.length !== 5) throw new Error('Expected installer, inventory, licenses, checks and checksums');
    run(['release', 'upload', tag, ...files, '--repo', repo]);
    console.log(`Uploaded ${platform} assets to draft ${tag}; draft remains unpublished`);
  } else throw new Error('Expected validate, package, stage or upload command');
}
