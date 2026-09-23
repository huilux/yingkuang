import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localProxyEnv } from './local-proxy-env.mjs';

test('native launch preserves proxies and merges both bypass lists with loopback hosts', () => {
  const original = { http_proxy: 'http://127.0.0.1:6789', https_proxy: 'http://127.0.0.1:6789',
    NO_PROXY: '.company.test, localhost', no_proxy: '192.168.1.2,.company.test', CUSTOM: 'unchanged' };
  const result = localProxyEnv(original);
  assert.equal(result.NO_PROXY, '.company.test,localhost,192.168.1.2,127.0.0.1,::1');
  assert.equal(result.no_proxy, result.NO_PROXY);
  assert.equal(result.http_proxy, original.http_proxy);
  assert.equal(result.https_proxy, original.https_proxy);
  assert.equal(result.CUSTOM, 'unchanged');
  assert.equal(original.no_proxy, '192.168.1.2,.company.test');
  assert.deepEqual(localProxyEnv(result), result);
});

test('fresh environments bypass only local hosts; wildcard bypass is preserved', () => {
  assert.equal(localProxyEnv({}).no_proxy, 'localhost,127.0.0.1,::1');
  assert.equal(localProxyEnv({ NO_PROXY: '*' }).NO_PROXY, '*,localhost,127.0.0.1,::1');
});
