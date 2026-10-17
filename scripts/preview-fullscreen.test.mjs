import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFullscreenSession} from '../src/preview-fullscreen.ts';

function fixture(initial=false) {
  let state=initial;
  const calls=[];
  const host={isFullscreen:async()=>state,setFullscreen:async value=>{calls.push(value);state=value;}};
  return {host,calls,get state(){return state;},set state(value){state=value;}};
}

test('enter, exit and close restore the initial normal window',async()=>{
  const window=fixture(),session=createFullscreenSession(window.host);
  assert.equal(await session.set(true),true);
  assert.equal(await session.set(false),false);
  await session.restore();await session.dispose();
  assert.deepEqual(window.calls,[true,false]);
});
test('closing while fullscreen restores the window; repeated disposal does not toggle again',async()=>{
  const window=fixture(),session=createFullscreenSession(window.host);
  await session.set(true);await session.restore();await session.dispose();
  assert.equal(window.state,false);assert.deepEqual(window.calls,[true,false]);
});
test('a window already fullscreen before preview remains fullscreen after close',async()=>{
  const window=fixture(true),session=createFullscreenSession(window.host);
  await session.set(false);await session.restore();await session.dispose();
  assert.equal(window.state,true);assert.deepEqual(window.calls,[false,true]);
});
test('closing during a pending enter waits then restores in order',async()=>{
  const window=fixture(),original=window.host.setFullscreen;
  let finish,started;
  const ready=new Promise(resolve=>{started=resolve;});
  window.host.setFullscreen=async value=>{if(value){started();await new Promise(resolve=>{finish=resolve;});}await original(value);};
  const session=createFullscreenSession(window.host),enter=session.set(true);
  await ready;const close=session.restore();finish();await Promise.all([enter,close]);
  assert.equal(window.state,false);assert.deepEqual(window.calls,[true,false]);
});
test('disposal cancels queued entry and restores an entry already in progress',async()=>{
  const first=fixture(),session=createFullscreenSession(first.host);
  const enter=session.set(true),close=session.dispose();await Promise.all([enter,close]);
  assert.deepEqual(first.calls,[]);
  const second=fixture(),active=createFullscreenSession(second.host);
  await active.set(true);await active.dispose();await active.set(true);
  assert.deepEqual(second.calls,[true,false]);
});
test('restoration sends exit even when the OS still reports the old normal state',async()=>{
  const window=fixture();window.host.setFullscreen=async value=>{window.calls.push(value);};
  const session=createFullscreenSession(window.host);
  await session.set(true);await session.restore();
  assert.deepEqual(window.calls,[true,false]);
});
test('failed exit can be retried even with a stale OS state',async()=>{
  const window=fixture();let fail=true;
  window.host.setFullscreen=async value=>{window.calls.push(value);if(!value&&fail)throw new Error('exit failed');};
  const session=createFullscreenSession(window.host);await session.set(true);
  await assert.rejects(session.restore(),/exit failed/);fail=false;await session.restore();
  assert.deepEqual(window.calls,[true,false,false]);
});
test('failed entry does not poison later attempts or cleanup',async()=>{
  const window=fixture(),original=window.host.setFullscreen;let fail=true;
  window.host.setFullscreen=async value=>{if(fail)throw new Error('permission denied');await original(value);};
  const session=createFullscreenSession(window.host);
  await assert.rejects(session.set(true),/permission denied/);fail=false;
  assert.equal(await session.set(true),true);await session.dispose();assert.equal(window.state,false);
});
test('fullscreen permission is scoped to the main window capability',()=>{
  const capability=JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json',import.meta.url),'utf8'));
  assert.deepEqual(capability.windows,['main']);
  assert.ok(capability.permissions.includes('core:window:allow-set-fullscreen'));
});
test('normal preview can close when the fullscreen host is unavailable',async()=>{
  const session=createFullscreenSession({isFullscreen:async()=>{throw new Error('window unavailable');},setFullscreen:async()=>{throw new Error('must not mutate');}});
  await assert.rejects(session.read(),/window unavailable/);
  await session.restore();await session.dispose();
});

test('persistent fullscreen rejection still allows closing an unchanged normal preview',async()=>{
  const window=fixture();
  window.host.setFullscreen=async value=>{window.calls.push(value);throw new Error('permission denied');};
  const session=createFullscreenSession(window.host);
  assert.equal(await session.read(),false);
  await assert.rejects(session.set(true),/permission denied/);
  await session.restore();await session.dispose();
  assert.equal(window.state,false);assert.deepEqual(window.calls,[true]);
});

for(const initial of [false,true])test(`initial fullscreen=${initial} is preserved when the OS changes it before the first preview command`,async()=>{
  const window=fixture(initial),session=createFullscreenSession(window.host);
  assert.equal(await session.read(),initial);
  window.state=!initial;assert.equal(await session.read(),!initial);
  await session.set(initial);await session.restore();await session.dispose();
  assert.equal(window.state,initial);assert.deepEqual(window.calls,[initial]);
});

test('closing restores an external fullscreen change even without using the toggle',async()=>{
  const window=fixture(),session=createFullscreenSession(window.host);
  await session.read();window.state=true;await session.read();
  await session.restore();await session.dispose();
  assert.equal(window.state,false);assert.deepEqual(window.calls,[false]);
});

test('discarded read-only setup does not undo fullscreen entered by another session',async()=>{
  const window=fixture(),session=createFullscreenSession(window.host);
  await session.read();window.state=true;await session.dispose();
  assert.equal(window.state,true);assert.deepEqual(window.calls,[]);
});

test('cleanup after successful close does not undo a subsequent fullscreen session',async()=>{
  const window=fixture(),session=createFullscreenSession(window.host);
  await session.read();await session.set(true);await session.restore();
  window.state=true;await session.dispose();
  assert.equal(window.state,true);assert.deepEqual(window.calls,[true,false]);
});

test('a rejected command that actually changed the window is still restored',async()=>{
  const window=fixture(),original=window.host.setFullscreen;
  window.host.setFullscreen=async value=>{await original(value);if(value)throw new Error('partial transition');};
  const session=createFullscreenSession(window.host);
  await session.read();await assert.rejects(session.set(true),/partial transition/);
  assert.equal(window.state,true);await session.restore();await session.dispose();
  assert.equal(window.state,false);assert.deepEqual(window.calls,[true,false]);
});

test('closing a command during its initial state query cancels the unapplied transition',async()=>{
  const window=fixture();let finish,started;
  const ready=new Promise(resolve=>{started=resolve;});
  window.host.isFullscreen=async()=>{started();await new Promise(resolve=>{finish=resolve;});return window.state;};
  const session=createFullscreenSession(window.host),enter=session.set(true);
  await ready;const close=session.dispose();finish();
  window.host.isFullscreen=async()=>window.state;
  await Promise.all([enter,close]);
  assert.equal(window.state,false);assert.deepEqual(window.calls,[]);
});
