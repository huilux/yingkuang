import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cropPixels, normalizedCrop, isValidPhotoCrop, moveCrop, fitCropRatio, resizeCrop, bitmapCrop, normalizeRotation, rotationDimensions, turnCrop, rotationFrameMapping, mapRotationCrop } from '../src/photo-crop.ts';
import { calculateGeometry, createDefaultDocument } from '../src/editor-model.ts';
import { buildExportPlan, createExportRequest, retryExportRequest } from '../src/export-workflow.ts';
import { parseSession, relocateSessionPath } from '../src/session-storage.ts';

test('crop edges quantize to original pixels including tiny, full and boundary selections', () => {
  const photo = { width: 6000, height: 4000 };
  assert.deepEqual(cropPixels(photo), { x: 0, y: 0, width: 6000, height: 4000 });
  const rect = { x: 1001, y: 777, width: 2345, height: 1234 };
  assert.deepEqual(cropPixels({ ...photo, crop: normalizedCrop(rect, photo) }), rect);
  assert.equal(normalizedCrop(cropPixels(photo), photo), undefined);
  assert.deepEqual(cropPixels({ width: 3, height: 5, crop: { x: .5, y: .5, width: .5, height: .5 } }), { x: 2, y: 3, width: 1, height: 2 });
  assert.deepEqual(cropPixels({ ...photo, crop: { x: .999999, y: .999999, width: .000001, height: .000001 } }), { x: 5999, y: 3999, width: 1, height: 1 });
  assert.deepEqual(bitmapCrop({ ...photo, crop: { x: .25, y: .25, width: .5, height: .5 } }, 600, 400), { x: 150, y: 100, width: 300, height: 200 });
});

test('dragging, numeric resizing and all handles remain within bounds and preserve locked ratio', () => {
  const bounds = { x: 0, y: 0, width: 6000, height: 4000 };
  const rect = { x: 1500, y: 1000, width: 3000, height: 2000 };
  assert.deepEqual(moveCrop(rect, -10000, 10000, bounds), { ...rect, x: 0, y: 2000 });
  assert.deepEqual(fitCropRatio(bounds, 1, bounds), { x: 1000, y: 0, width: 4000, height: 4000 });
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    for (const dx of [-10000, -200, 0, 500, 10000]) for (const dy of [-10000, -300, 0, 500, 10000]) {
      for (const ratio of [undefined, 1, 1.5, 2 / 3, 16 / 9]) {
        const next = resizeCrop(rect, handle, dx, dy, bounds, ratio);
        assert.ok(next.x >= 0 && next.y >= 0 && next.width >= 1 && next.height >= 1);
        assert.ok(next.x + next.width <= bounds.width && next.y + next.height <= bounds.height);
        if (ratio) assert.ok(Math.abs(next.width - next.height * ratio) <= 2, JSON.stringify({handle, dx, dy, ratio, next}));
      }
    }
  }
});

test('crop survives session relocation and rejects invalid persisted coordinates', () => {
  const crop = { x: .25, y: .2, width: .5, height: .4 };
  const saved = { paths: ['old.jpg'], cropsByPath: { 'old.jpg': crop } };
  assert.deepEqual(parseSession(JSON.stringify(saved)), saved);
  assert.deepEqual(relocateSessionPath(saved, 'old.jpg', 'new.jpg').cropsByPath, { 'new.jpg': crop });
  for (const bad of [null, [], {}, { ...crop, x: -1 }, { ...crop, width: 0 }, { ...crop, height: Infinity }, { ...crop, y: .9 }, { ...crop, x: '0' }]) {
    assert.equal(isValidPhotoCrop(bad), false);
    assert.throws(() => parseSession(JSON.stringify({ ...saved, cropsByPath: { 'old.jpg': bad } })), /裁切/);
  }
});

test('preview geometry, original pixels, no-upscale and frozen retry use the per-photo crop', () => {
  const photo = { id: 'a', path: '/a.png', fileName: 'a.png', width: 6000, height: 4000, metadata: {}, crop: { x: .25, y: .25, width: .5, height: .5 } };
  const doc = createDefaultDocument();
  doc.frame.paddingX = 0; doc.frame.paddingY = 0;
  Object.values(doc.regions).forEach(region => { region.enabled = false; });
  const settings = { directory: '/tmp', format: 'png', quality: 92, size: 'original', longEdge: 6000, noUpscale: false, metadata: 'none', includeGps: false, range: 'all', suffix: '', collision: 'number', pngCompression: 'standard' };
  const input = { photos: [photo], documents: { a: doc }, settings, activeId: 'a', checkedIds: [] };
  assert.equal(calculateGeometry(photo, doc).photo.width / calculateGeometry(photo, doc).photo.height, 1.5);
  const plan = buildExportPlan(input);
  assert.equal(plan.sampleDimensions, '3000 × 2000');
  assert.equal(buildExportPlan({ ...input, settings: { ...settings, size: 'long-edge', noUpscale: true } }).sampleDimensions, '3000 × 2000');
  const request = createExportRequest(plan.items, settings);
  photo.crop.x = 0;
  const retry = retryExportRequest(request, new Set(['/a.png']));
  assert.equal(retry.items[0].crop.x, .25);
  retry.items[0].crop.width = .1;
  assert.equal(request.items[0].crop.width, .5);
});

test('rotation bounds match shared Rust fixtures and contain no empty corner at any angle', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/photo-rotation.json', import.meta.url)));
  for (const f of fixtures) assert.deepEqual(rotationDimensions(f.width, f.height, f.angle), {width:f.outputWidth,height:f.outputHeight});
  for (const [width, height] of [[6000,4000], [301,701], [100,100]]) {
    for (let angle = -180; angle <= 180; angle += .5) {
      const bounds = rotationDimensions(width,height,angle);
      assert.ok(bounds.width * bounds.height <= width * height);
      const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
      for (const x of [-bounds.width/2, bounds.width/2]) for (const y of [-bounds.height/2, bounds.height/2]) {
        assert.ok(Math.abs(c*x+s*y) <= width/2+1e-7 && Math.abs(-s*x+c*y) <= height/2+1e-7, JSON.stringify({width,height,angle,bounds}));
      }
    }
  }
  assert.deepEqual(rotationDimensions(6000,4000,90), {width:4000,height:6000});
  assert.deepEqual(rotationDimensions(100,100,45), {width:70,height:70});
});

test('quarter turns preserve selected pixels over a complete cycle and fine rotation survives all snapshots', () => {
  const original = {x:17,y:11,width:51,height:37};
  const photo = {id:'a',path:'/a.png',fileName:'a.png',width:701,height:301,metadata:{}};
  for (const initialAngle of [0,17.3,-45,135]) {
    let rect = {...original}, angle = initialAngle;
    for (let i=0;i<4;i++) {
      const bounds = rotationDimensions(photo.width,photo.height,angle);
      const next = turnCrop(rect,bounds,true);
      assert.deepEqual(turnCrop(next,{width:bounds.height,height:bounds.width},false),rect);
      angle=normalizeRotation(angle+90); rect=next;
      const crop=normalizedCrop(rect,photo,angle);
      assert.deepEqual(cropPixels({...photo,crop}),rect);
    }
    assert.deepEqual(rect,original); assert.equal(angle,initialAngle);
  }
  const crop = {x:.25,y:.2,width:.5,height:.4,rotation:103.7};
  const saved = {paths:[photo.path],cropsByPath:{[photo.path]:crop}};
  assert.deepEqual(parseSession(JSON.stringify(saved)).cropsByPath[photo.path],crop);
  assert.deepEqual(relocateSessionPath(saved,photo.path,'/moved.png').cropsByPath['/moved.png'],crop);
  const settings = {directory:'/tmp',format:'png',quality:92,size:'original',longEdge:6000,noUpscale:false,metadata:'none',includeGps:false,range:'all',suffix:'',collision:'number',pngCompression:'standard'};
  const plan = buildExportPlan({photos:[{...photo,crop}],documents:{a:createDefaultDocument()},settings,activeId:'a',checkedIds:[]});
  const request = createExportRequest(plan.items,settings);
  crop.rotation=0;
  assert.equal(retryExportRequest(request,new Set([photo.path])).items[0].crop.rotation,103.7);
  for(const rotation of [NaN,Infinity,-181,181,'90',null]) assert.equal(isValidPhotoCrop({...crop,rotation}),false);
});

test('a fixed rotation frame keeps crop aspect and maps to the same saved and exported pixels', () => {
  const photo={width:6000,height:4000};
  const frame={width:6000,height:4000};
  const rect={x:1200,y:800,width:3000,height:2000};
  for(const angle of [-45,-17.3,0,13.7,45]) {
    const bounds=rotationDimensions(photo.width,photo.height,angle);
    const mapping=rotationFrameMapping(frame,bounds);
    const selected=mapRotationCrop(rect,mapping);
    assert.ok(selected.x>=0 && selected.y>=0 && selected.x+selected.width<=bounds.width+1e-9 && selected.y+selected.height<=bounds.height+1e-9);
    assert.ok(Math.abs(selected.width/selected.height-1.5)<1e-9);
    assert.ok(Math.abs((selected.x-mapping.x)/mapping.scale-rect.x)<1e-9);
    assert.ok(Math.abs((selected.y-mapping.y)/mapping.scale-rect.y)<1e-9);
    const output=cropPixels({...photo,crop:normalizedCrop(selected,photo,angle)});
    const reopened=cropPixels({...photo,crop:normalizedCrop(output,photo,angle)});
    assert.deepEqual(reopened,output);
    assert.ok(Math.abs(output.width/output.height-1.5)<.005);
  }
  assert.deepEqual(mapRotationCrop(rect,rotationFrameMapping(frame,frame)),rect);
});
