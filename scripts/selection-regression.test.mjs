import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLayer, arrangeSelection, moveSelection } from '../src/selection-model.ts';
const canvas = { x: 0, y: 0, width: 1000, height: 800 };
const geometry = { width: 1000, height: 800, photo: { x: 100, y: 100, width: 800, height: 500 }, regions: { canvas, bottom: { x: 0, y: 600, width: 1000, height: 200 }, left: { x: 0, y: 100, width: 100, height: 500 } } };
const measured = [
  { id: 'a', position: { x: 50, y: 650 }, bounds: { x: 0, y: 640, width: 100, height: 20 } },
  { id: 'b', position: { x: 330, y: 670 }, bounds: { x: 230, y: 660, width: 200, height: 20 } },
  { id: 'c', position: { x: 750, y: 680 }, bounds: { x: 725, y: 670, width: 50, height: 20 } },
];
const layers = measured.map(item => ({ id: item.id, region: 'bottom', x: item.position.x / 1000, y: (item.position.y - 600) / 200 }));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
test('Shift toggles; dragging a selected member preserves the group', () => {
  assert.deepEqual(selectLayer(['a'], 'b', true), ['a','b']);
  assert.deepEqual(selectLayer(['a','b'], 'a', true), ['b']);
  assert.deepEqual(selectLayer(['a','b'], 'a', false, true), ['a','b']);
  assert.deepEqual(selectLayer(['a','b'], 'a'), ['a']);
});
test('distribution preserves outer bounds and equalizes gaps for unequal/rotated widths', () => {
  const patches = arrangeSelection('distribute-x','canvas',measured,layers,geometry);
  const lefts = measured.map((item,i) => patches[i].patch.x * 1000 - item.bounds.width / 2);
  near(lefts[0], 0); near(lefts[2] + 50, 775);
  near(lefts[1] - lefts[0] - 100, lefts[2] - lefts[1] - 200);
  assert.deepEqual(arrangeSelection('distribute-x','canvas',measured.slice(0,2),layers,geometry), []);
});
test('group alignment keeps spacing and permits movement outside the assigned region', () => {
  const patches = arrangeSelection('center-y','photo',measured,layers,geometry);
  const deltas = patches.map((item,i) => 600 + item.patch.y * 200 - measured[i].position.y);
  near(deltas[0],deltas[1]); near(deltas[1],deltas[2]);
  near(640 + deltas[0] + 50 / 2, 350);
  assert.ok(patches[0].patch.y < 0);
});
test('align-to-selection moves each object, not the entire group', () => {
  const patches = arrangeSelection('center-y','selection',measured,layers,geometry);
  patches.forEach(item => near(600 + item.patch.y * 200, 665));
});
test('cross-region movement preserves the same world-space delta', () => {
  const cross = [{ ...layers[0], region:'left', x:.5,y:.5 },layers[1]];
  const patches = moveSelection(cross, geometry, {x:40,y:20});
  near((patches[0].patch.x-cross[0].x)*100,40);
  near((patches[1].patch.x-cross[1].x)*1000,40);
});
test('vertical distribution uses heights and preserves the top and bottom endpoints', () => {
  const vertical = measured.map(item => ({ ...item, position: { x:item.position.y,y:item.position.x }, bounds: { x:item.bounds.y,y:item.bounds.x,width:item.bounds.height,height:item.bounds.width } }));
  const rotatedLayers = vertical.map(item => ({ id:item.id,region:'canvas',x:item.position.x/1000,y:item.position.y/800 }));
  const patches = arrangeSelection('distribute-y','canvas',vertical,rotatedLayers,geometry);
  const tops = vertical.map((item,i) => patches[i].patch.y * 800-item.bounds.height/2);
  near(tops[0],0); near(tops[2]+50,775); near(tops[1]-tops[0]-100,tops[2]-tops[1]-200);
});
