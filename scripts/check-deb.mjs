import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function checkDeb(path, version) {
  const result = spawnSync('dpkg-deb', ['--field', path], { encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  const fields = Object.fromEntries(result.stdout.split('\n').filter(line => /^[A-Za-z-]+:/.test(line)).map(line => {
    const index = line.indexOf(':');
    return [line.slice(0, index), line.slice(index + 1).trim()];
  }));
  if (fields.Package !== 'yingkuang') throw new Error(`Invalid Debian package name: ${fields.Package}`);
  if (fields.Version !== version || fields.Architecture !== 'amd64') throw new Error('Unexpected Debian package version or architecture');
  // Stream the actual payload through tar; the archive path is a positional
  // argument, never interpolated into shell source.
  const desktop = spawnSync('bash', ['-o', 'pipefail', '-c', 'dpkg-deb --fsys-tarfile "$1" | tar -xOf - usr/share/applications/yingkuang.desktop', 'check-deb', path], { encoding: 'utf8', timeout: 60000 });
  if (desktop.error) throw desktop.error;
  if (desktop.status !== 0) throw new Error(desktop.stderr.trim());
  const lines = desktop.stdout.split('\n');
  const categories = lines.find(line => line.startsWith('Categories='))?.slice(11).split(';') ?? [];
  if (!lines.includes('Name=映框') || !lines.includes('Exec=yingkuang') || !categories.includes('Photography')) throw new Error('Invalid desktop display name, executable or photography category');
  return fields;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify(checkDeb(process.argv[2], version)));
}
