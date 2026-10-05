import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Tauri 2.11.5 downloads this plugin separately from the CLI. Pin its source
// and keep our fix in the project cache, independent of global cached plugins.
const revision = 'dda522bce37387f1b853d9095713bfaa924c8423';
const upstreamHash = '7804c9eef13e59bf2783aad9882ef9db8f3f3f9e8d631874b1d348d550a3693f';
const patchedHash = '95eeb15c2eb3e595c102ec8284b017b2a369ac0afddf1c8475fab04c069a0aa9';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = source => createHash('sha256').update(source).digest('hex');

if (process.platform !== 'linux') throw new Error('AppImage builds require Linux');
if (process.argv.length > 2) throw new Error('Run npm run build:appimage without extra arguments');
const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
  cwd: join(root, 'src-tauri'), encoding: 'utf8',
});
if (metadata.error) throw metadata.error;
if (metadata.status !== 0) throw new Error(`Cannot locate Cargo target directory: ${metadata.stderr}`);
const plugin = join(JSON.parse(metadata.stdout).target_directory, '.tauri', 'linuxdeploy-plugin-gtk.sh');

let cached;
try { cached = await readFile(plugin, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!cached || hash(cached) !== patchedHash) {
  console.log(`Preparing GTK packaging plugin at ${revision}`);
  const response = await fetch(`https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/${revision}/linuxdeploy-plugin-gtk.sh`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GTK plugin download failed: HTTP ${response.status}`);
  const source = await response.text();
  if (hash(source) !== upstreamHash) throw new Error('GTK plugin checksum mismatch; refusing to execute it');
  // pkg-config supplies the exact library directory. Recursive discovery also
  // collects private VMware libraries and debug symbols under /usr/lib.
  const before = 'find "$directory" \\( -type l -o -type f \\) -name "$library" -print0';
  if (source.split(before).length !== 2) throw new Error('GTK plugin changed; review the library scan fix');
  const patched = source.replace(before, before.replace('find "$directory"', 'find "$directory" -maxdepth 1'));
  if (hash(patched) !== patchedHash) throw new Error('Patched GTK plugin checksum mismatch');
  await mkdir(dirname(plugin), { recursive: true });
  await writeFile(plugin, patched, { mode: 0o770 });
}
await chmod(plugin, 0o770);

// Cargo already strips the application. linuxdeploy's older strip cannot read
// modern Arch RELR sections in system libraries; leave those libraries intact.
const result = spawnSync(process.execPath, ['scripts/tauri.mjs', 'build', '--bundles', 'appimage', '--verbose', '--config', JSON.stringify({ bundle: { useLocalToolsDir: true } })], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NO_STRIP: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
