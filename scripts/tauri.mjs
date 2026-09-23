import { localProxyEnv } from './local-proxy-env.mjs';

// Set these before loading the native CLI, so Vite and the WebView inherit
// the same local bypass rules. Do not change the user's global proxy settings.
const env = localProxyEnv(process.env);
process.env.NO_PROXY = env.NO_PROXY;
process.env.no_proxy = env.no_proxy;

const { default: cli } = await import('@tauri-apps/cli');
try {
  await cli.run(process.argv.slice(2), 'npm run tauri');
} catch (error) {
  cli.logError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
