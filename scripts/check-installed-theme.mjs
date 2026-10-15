// Drive real pointer/keyboard input in the installed WebView2, not DOM click() mocks.
// The debug port is enabled only by the CI smoke process, never in app configuration.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint ?? '')) throw new Error('Expected a local test debugging endpoint');
let target;
for (let attempt = 0; attempt < 100 && !target; attempt++) {
  try {
    const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1000) });
    target = (await response.json()).find(page => page.type === 'page' && /(?:tauri\.localhost|localhost:1424)/.test(page.url));
  } catch { /* WebView may still be starting. */ }
  if (!target) await delay(100);
}
assert.ok(target?.webSocketDebuggerUrl, 'Installed application debugging target not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
let serial = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id); clearTimeout(entry.timer);
  if (response.error) entry.reject(new Error(JSON.stringify(response.error))); else entry.resolve(response.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await evaluate(expression)) return; }
    catch { /* Page.reload can briefly replace the execution context. */ }
    await delay(50);
  }
  throw new Error(`Condition not reached: ${expression}`);
}
const state = () => evaluate(`({preference: document.documentElement.dataset.themePreference, theme: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor})`);
async function check(preference) {
  await waitFor(`document.documentElement.dataset.themePreference === ${JSON.stringify(preference)}`);
  const actual = await state();
  const expected = preference === 'system' ? await evaluate(`matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`) : preference;
  assert.equal(actual.theme, expected);
  assert.equal(actual.background, expected === 'dark' ? 'rgb(23, 25, 24)' : 'rgb(231, 233, 230)', 'Theme state changed without applying colors');
  return actual;
}
async function click() {
  const point = await evaluate(`(() => { const b = document.querySelector('button.theme-control svg').getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; })()`);
  await send('Input.dispatchMouseEvent', {type: 'mouseMoved', ...point});
  await send('Input.dispatchMouseEvent', {type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1});
}
try {
  await waitFor(`!!document.querySelector('button.theme-control svg')`);
  assert.equal(await evaluate(`document.querySelector('button.theme-control').textContent.trim()`), '');
  const order = ['system', 'light', 'dark'];
  let preference = (await state()).preference;
  for (let i = 0; i < 3; i++) {
    await click(); preference = order[(order.indexOf(preference) + 1) % 3]; await check(preference);
  }
  for (const [key, code, keyCode] of [['Enter', 'Enter', 13], [' ', 'Space', 32]]) {
    await evaluate(`document.querySelector('button.theme-control').focus()`);
    await send('Input.dispatchKeyEvent', {type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode});
    await send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode});
    preference = order[(order.indexOf(preference) + 1) % 3]; await check(preference);
  }
  // Reload verifies startup uses the preference saved by the real click handler.
  await evaluate(`document.documentElement.dataset.themeReloadProbe = 'pending'`);
  await send('Page.reload', {ignoreCache: true});
  await waitFor(`document.documentElement.dataset.themeReloadProbe !== 'pending' && !!document.querySelector('button.theme-control svg')`); await check(preference);
  for (let i = 0; preference !== 'system' && i < 3; i++) {
    await click(); preference = order[(order.indexOf(preference) + 1) % 3]; await check(preference);
  }
  for (const value of ['dark', 'light']) {
    await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value}]});
    await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(value)}`); await check('system');
  }
  await send('Emulation.setEmulatedMedia', {features: []});
  const report = {pointerCycle: 'passed', keyboardCycle: 'passed', appliedColors: 'passed', reloadPersistence: 'passed', systemChanges: 'passed'};
  await writeFile('test-output/beta-theme-windows-x64.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { socket.close(); }
