import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseTargets, withLicenseConfig, prepareBundleLicenses } from './bundle-licenses.mjs';

test('license target follows explicit cross-compilation options and both universal slices', () => {
  const host = 'x86_64-unknown-linux-gnu';
  assert.deepEqual(licenseTargets(['build'], host), [host]);
  for (const option of [['--target', 'universal-apple-darwin'], ['--target=universal-apple-darwin'], ['-t', 'universal-apple-darwin']]) {
    assert.deepEqual(licenseTargets(['build', ...option], host), ['aarch64-apple-darwin', 'x86_64-apple-darwin']);
  }
  assert.deepEqual(licenseTargets(['build', '--', '--target', 'other'], host), [host]);
  assert.throws(() => licenseTargets(['build', '--target', '../outside'], host));
});

test('license overlay preserves AppImage config and Cargo arguments', () => {
  const args = ['build', '--config', '{"bundle":{"useLocalToolsDir":true}}', '--', '--locked'];
  const result = withLicenseConfig(args, { '../file': 'licenses/file' });
  assert.deepEqual(result.slice(0, 3), args.slice(0, 3));
  assert.deepEqual(result.slice(-2), ['--', '--locked']);
  assert.deepEqual(JSON.parse(result[4]), { bundle: { resources: { '../file': 'licenses/file' } } });
});

test('development and CLI help need no generated license files', async () => {
  for (const args of [['dev'], ['build', '--help'], ['icon'], ['bundle', '-h']]) {
    assert.deepEqual(await prepareBundleLicenses(args), args);
  }
});
