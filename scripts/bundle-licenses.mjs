import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function licenseTargets(args, host) {
  const options = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'));
  let target = host;
  for (let index = 1; index < options.length; index++) {
    if (['-t', '--target'].includes(options[index])) target = options[++index];
    else if (options[index].startsWith('--target=')) target = options[index].slice(9);
    else if (options[index].startsWith('-t') && options[index].length > 2) target = options[index].slice(2);
  }
  if (!target || !/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('Invalid Rust target for license collection');
  return target === 'universal-apple-darwin'
    ? ['aarch64-apple-darwin', 'x86_64-apple-darwin'] : [target];
}

export function withLicenseConfig(args, resources) {
  const result = [...args];
  const separator = result.indexOf('--');
  result.splice(separator < 0 ? result.length : separator, 0, '--config', JSON.stringify({ bundle: { resources } }));
  return result;
}

export async function prepareBundleLicenses(args) {
  if (!['build', 'bundle'].includes(args[0]) || args.includes('--help') || args.includes('-h')) return args;
  const rustc = spawnSync('rustc', ['-vV'], { cwd: root, encoding: 'utf8' });
  if (rustc.error) throw rustc.error;
  if (rustc.status !== 0) throw new Error(rustc.stderr);
  const targets = licenseTargets(args, process.env.CARGO_BUILD_TARGET || rustc.stdout.match(/^host: (.+)$/m)?.[1]);
  const resources = {};
  for (const target of targets) {
    const collected = spawnSync(process.execPath, ['scripts/collect-licenses.mjs', target], { cwd: root, stdio: 'inherit' });
    if (collected.error) throw collected.error;
    if (collected.status !== 0) throw new Error(`License collection failed for ${target}`);
    const inventory = JSON.parse(await readFile(new URL(`../test-output/licenses/${target}/inventory.json`, import.meta.url), 'utf8'));
    if (inventory.missingTexts.length) throw new Error(`Missing license texts for ${target}; inspect inventory.json before packaging`);
    if (inventory.reviewRequired.length) console.warn(`${target}: ${inventory.reviewRequired.length} license review items remain; see bundled inventory.json`);
    for (const file of ['inventory.json', 'LICENSE-TEXTS.txt']) {
      resources[`../test-output/licenses/${target}/${file}`] = `licenses/dependencies/${target}/${file}`;
    }
  }
  // Tauri merges repeated configs in order; object resources retain base entries.
  // Insert before Cargo's argument separator, preserving existing packaging options.
  return withLicenseConfig(args, resources);
}
