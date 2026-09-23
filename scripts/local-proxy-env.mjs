// WebKitGTK inherits proxy variables. A proxy may return an empty 502 response
// for Vite's localhost URL, leaving the native window completely blank.
export function localProxyEnv(env) {
  const hosts = new Set([env.NO_PROXY, env.no_proxy].flatMap(value =>
    (value ?? '').split(',').map(host => host.trim()).filter(Boolean)));
  for (const host of ['localhost', '127.0.0.1', '::1']) hosts.add(host);
  const bypass = [...hosts].join(',');
  return { ...env, NO_PROXY: bypass, no_proxy: bypass };
}
