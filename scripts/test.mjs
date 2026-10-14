import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Expand paths in Node: Windows shells do not expand Unix globs.
const root = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(new URL('./', import.meta.url))
  .filter(name => name.endsWith('.test.mjs') && name !== 'bundle-budget.test.mjs')
  .sort().map(name => `scripts/${name}`);
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
