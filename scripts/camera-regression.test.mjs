import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt, screenToWorld, fitCamera, snapSelection, clampZoom, previewMaximumZoom } from '../src/canvas-camera.ts';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('moving zoom anchors remain invariant across tiny events and round trips', () => {
  let camera = { x: 53.2, y: -71.8, scale: 0.48 };
  for (let i = 0; i < 1000; i++) {
    const pointer = { x: 200 + Math.sin(i) * 20, y: 150 + Math.cos(i) * 20 };
    const before = screenToWorld(pointer, camera);
    camera = zoomAt(camera, camera.scale * (i % 2 ? 1 / 1.01 : 1.01), pointer);
    const after = screenToWorld(pointer, camera);
    near(before.x, after.x); near(before.y, after.y);
  }
  near(camera.scale, 0.48);
});
test('portrait and landscape fit at viewport centre', () => {
  for (const scene of [{ width: 1700, height: 1100 }, { width: 1100, height: 1700 }]) {
    const camera = fitCamera({ width: 800, height: 600 }, scene);
    near(camera.x + scene.width * camera.scale / 2, 400);
    near(camera.y + scene.height * camera.scale / 2, 300);
    assert.ok(scene.width * camera.scale <= 720 && scene.height * camera.scale <= 520);
  }
});
test('large preview fits a 4K window without changing the editor zoom limit', () => {
  assert.equal(clampZoom(1000),300);
  assert.equal(clampZoom(1000,previewMaximumZoom),1000);
  assert.equal(clampZoom(Infinity,previewMaximumZoom),previewMaximumZoom);
  assert.equal(clampZoom(0,previewMaximumZoom),10);
  const viewport={width:3840,height:2160};
  for(const scene of [{width:1700,height:1100},{width:1100,height:1700}]) {
    const camera=fitCamera(viewport,scene,previewMaximumZoom);
    near(camera.x+scene.width*camera.scale/2,viewport.width/2);
    near(camera.y+scene.height*camera.scale/2,viewport.height/2);
    near(Math.max(scene.width*camera.scale/(viewport.width-80),scene.height*camera.scale/(viewport.height-80)),1);
    assert.ok(camera.scale>=fitCamera(viewport,scene).scale);
  }
  assert.ok(fitCamera(viewport,{width:1700,height:1100},previewMaximumZoom).scale>fitCamera(viewport,{width:1700,height:1100}).scale);
});
test('snapping uses screen pixels; bypass preserves the requested group delta', () => {
  const canvas = { x:0,y:0,width:1000,height:1000 };
  const bounds = { x:450,y:190,width:100,height:20 };
  const geometry = { width:1000,height:1000,photo:canvas,regions:{canvas} };
  for (const scale of [0.2,0.5,1,2]) {
    near(snapSelection(bounds,{x:5/scale,y:0},geometry,[],[],scale,true).delta.x,0);
    near(snapSelection(bounds,{x:7/scale,y:0},geometry,[],[],scale,true).delta.x,7/scale);
  }
  assert.deepEqual(snapSelection(bounds,{x:-600,y:1200},geometry,[],[],1,false).delta,{x:-600,y:1200});
});
test('image-only fullscreen fits the complete composition without editor margins', () => {
  for (const viewport of [{width:800,height:600},{width:3840,height:2160}]) {
    for (const scene of [{width:1700,height:1100},{width:1100,height:1700}]) {
      const camera=fitCamera(viewport,scene,previewMaximumZoom,0);
      near(camera.x+scene.width*camera.scale/2,viewport.width/2);
      near(camera.y+scene.height*camera.scale/2,viewport.height/2);
      near(Math.max(scene.width*camera.scale/viewport.width,scene.height*camera.scale/viewport.height),1);
      assert.ok(scene.width*camera.scale<=viewport.width+1e-8&&scene.height*camera.scale<=viewport.height+1e-8);
      assert.deepEqual(fitCamera(viewport,scene),fitCamera(viewport,scene,300,80));
    }
  }
});
