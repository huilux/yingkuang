import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInTemplates, calculateGeometry, layerPosition } from '../src/editor-model.ts';
import { arrangeSelection, distributionMetrics, moveSelection, selectionLineAxis } from '../src/selection-model.ts';
import { commitArrangement, measureDocumentLayers, releaseLayoutRules, resolveDocumentLayout, setDistributionRange } from '../src/document-layout.ts';
import { builtInTemplateChanges, isValidEditorDocument } from '../src/builtin-template-catalog.ts';
import { reorientTemplateDocument } from '../src/template-layout.ts';
import { parseTemplateBackup, serializeTemplateBackup } from '../src/template-library.ts';
import { prepareOfficialCatalog } from '../src/official-templates.ts';

const template=builtInTemplates().find(item=>item.id==='wide-float');
const a={id:'a',width:6000,height:4000,metadata:{focalLength:'50mm',aperture:'f/2',iso:'ISO100'}};
const b={...a,id:'b',width:8000,height:4000,metadata:{focalLength:'135mm',aperture:'f/11',iso:'ISO12800'}};
const size=(layer,text)=>({width:Math.max(...text.split('\n').map(line=>line.length*12.37)),height:text.split('\n').length*layer.fontSize});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
function fixture(axis='x',count=3) {
  const doc=structuredClone(template.layouts.landscape),layer=doc.layers.find(item=>item.source==='focalLength');
  doc.layers=['focalLength','aperture','iso','shutter'].slice(0,count).map((source,i)=>({...layer,id:String(i),source,region:'canvas',x:axis==='x'?.2+i*.2:.5,y:axis==='y'?.2+i*.2:.5,rotation:axis==='y'?90:0}));
  delete doc.distributions; delete doc.alignments;return doc;
}
const ids=doc=>doc.layers.map(layer=>layer.id);
const measured=(doc,photo,selected=ids(doc))=>measureDocumentLayers(doc,photo,size,selected);
const metrics=(doc,photo,axis,reference='canvas',selected=ids(doc))=>distributionMetrics(axis,reference,measured(doc,photo,selected),calculateGeometry(photo,doc),doc.regions);
function arrange(doc,photo,action,selected=ids(doc),reference='canvas') {
  const geometry=calculateGeometry(photo,doc);
  commitArrangement(doc,arrangeSelection(action,reference,measured(doc,photo,selected),doc.layers,geometry,doc.regions),action,reference,geometry);
}
function unchanged(before,after,photo) {
  const geometry=calculateGeometry(photo,before);
  before.layers.forEach((layer,i)=>{const p=layerPosition(layer,geometry),q=layerPosition(after.layers[i],geometry);near(p.x,q.x);near(p.y,q.y);});
}
function equalGaps(doc,photo,axis) {
  const dimension=axis==='x'?'width':'height',items=measured(doc,photo).sort((x,y)=>x.bounds[axis]-y.bounds[axis]);
  const gaps=items.slice(1).map((item,i)=>item.bounds[axis]-items[i].bounds[axis]-items[i].bounds[dimension]);
  gaps.forEach(gap=>{near(gap,gaps[0]);assert.ok(gap>=-1e-8);});
}

for(const axis of ['x','y']) test(`${axis} fixed 60% span survives changing photos, repeated distribution/centering and rotation`,()=>{
  let doc=fixture(axis);const styles=doc.layers.map(({fontSize,fontFamily,rotation})=>({fontSize,fontFamily,rotation}));
  const before=metrics(doc,a,axis),dimension=axis==='x'?'width':'height';
  const center=before.bounds[axis]+before.bounds[dimension]/2;
  setDistributionRange(doc,a,ids(doc),axis,{reference:'canvas',ratio:.6},size);
  near(metrics(doc,a,axis).ratio,.6);near(metrics(doc,a,axis).bounds[axis]+metrics(doc,a,axis).bounds[dimension]/2,center);
  arrange(doc,a,`center-${axis}`);
  for(const photo of [b,a,b]) {
    doc=resolveDocumentLayout(doc,photo,size);const saved=structuredClone(doc);
    near(metrics(doc,photo,axis).ratio,.6);equalGaps(doc,photo,axis);
    arrange(doc,photo,`distribute-${axis}`);arrange(doc,photo,`center-${axis}`);
    unchanged(saved,doc,photo);unchanged(doc,resolveDocumentLayout(doc,photo,size),photo);
    assert.equal(doc.distributions[0].range.ratio,.6);assert.ok(isValidEditorDocument(doc));
  }
  assert.deepEqual(doc.layers.map(({fontSize,fontFamily,rotation})=>({fontSize,fontFamily,rotation})),styles);
});
for(const action of ['left','center-x','right']) test(`resizing retains ${action} and stays stable`,()=>{
  let doc=fixture();arrange(doc,a,action);
  setDistributionRange(doc,a,ids(doc),'x',{reference:'photo',ratio:.55},size);
  for(const photo of [a,b]) {
    doc=resolveDocumentLayout(doc,photo,size);const saved=structuredClone(doc);arrange(doc,photo,action);
    unchanged(saved,doc,photo);near(metrics(doc,photo,'x','photo').ratio,.55);
  }
});
test('nested group alignment updates range anchors without repeated-resolution drift',()=>{
  let doc=fixture('x',4);const selected=['0','1','2'];
  setDistributionRange(doc,a,selected,'x',{reference:'canvas',ratio:.4},size);
  arrange(doc,a,'center-x');doc=resolveDocumentLayout(doc,b,size);
  for(let i=0;i<5;i++){const next=resolveDocumentLayout(doc,b,size);unchanged(doc,next,b);doc=next;}
  near(metrics(doc,b,'x','canvas',selected).ratio,.4);
});
test('resizing a subset releases its parent alignment and leaves unselected elements unchanged',()=>{
  const doc=fixture('x',4);arrange(doc,a,'center-x');const other=structuredClone(doc.layers[3]);
  setDistributionRange(doc,a,['0','1','2'],'x',{reference:'canvas',ratio:.5},size);
  assert.equal(doc.alignments,undefined);assert.deepEqual(doc.layers[3],other);
});
test('whole group translation updates the anchor; moving one member releases the range',()=>{
  const doc=fixture();setDistributionRange(doc,a,ids(doc),'x',{reference:'canvas',ratio:.6},size);
  const before=structuredClone(doc),geometry=calculateGeometry(a,doc),patches=moveSelection(doc.layers,geometry,{x:32,y:0});
  releaseLayoutRules(doc,patches,geometry);patches.forEach(({id,patch})=>Object.assign(doc.layers.find(layer=>layer.id===id),patch));
  const next=resolveDocumentLayout(doc,a,size);
  next.layers.forEach((layer,i)=>near(layerPosition(layer,geometry).x-layerPosition(before.layers[i],geometry).x,32));
  near(metrics(next,a,'x').ratio,.6);
  releaseLayoutRules(next,[{id:'1',patch:{x:next.layers[1].x+.01}}],geometry);assert.equal(next.distributions,undefined);
});
test('long metadata expands only the effective span and keeps the saved target',()=>{
  const doc=fixture();setDistributionRange(doc,a,ids(doc),'x',{reference:'canvas',ratio:.3},size);
  const long={...b,metadata:{focalLength:'LONG '.repeat(30),aperture:'f/11',iso:'ISO12800'}};
  const overflow=resolveDocumentLayout(doc,long,size),m=metrics(overflow,long,'x');
  assert.ok(m.ratio>.3);near(m.ratio,m.minimumRatio);equalGaps(overflow,long,'x');
  assert.equal(overflow.distributions[0].range.ratio,.3);
  near(metrics(resolveDocumentLayout(overflow,a,size),a,'x').ratio,.3);
  assert.deepEqual(overflow.distributions[0].layerIds,['0','1','2']);
});
test('two-element ranges are valid and reset preserves coordinates; three-element reset keeps equal gaps',()=>{
  for(const count of [2,3]) {
    const doc=fixture('x',count);setDistributionRange(doc,a,ids(doc),'x',{reference:'canvas',ratio:.6},size);
    assert.ok(isValidEditorDocument(doc));near(metrics(doc,a,'x').ratio,.6);const before=structuredClone(doc);
    setDistributionRange(doc,a,ids(doc),'x',null,size);unchanged(before,doc,a);
    assert.ok(isValidEditorDocument(doc));assert.equal(doc.distributions?.[0].range,undefined);
    if(count===2)assert.equal(doc.distributions,undefined);
  }
});
test('ranges use safe available region dimensions and skip a disabled reference',()=>{
  const doc=fixture();doc.regions.bottom.safePadding=12;
  setDistributionRange(doc,a,ids(doc),'x',{reference:'bottom',ratio:.6},size);
  near(metrics(doc,a,'x','bottom').ratio,.6);const before=structuredClone(doc);doc.regions.bottom.enabled=false;
  unchanged(before,resolveDocumentLayout(doc,a,size),a);
});
test('backup and sanitized official preparation retain ranges without unknown private fields',()=>{
  const doc=fixture();setDistributionRange(doc,a,ids(doc),'x',{reference:'canvas',ratio:.6},size);
  const record={...structuredClone(template),layouts:{landscape:doc}};
  const restored=parseTemplateBackup(serializeTemplateBackup([record],record.id)).templates[0];
  assert.deepEqual(restored.layouts.landscape.distributions,doc.distributions);
  doc.distributions[0].range.privatePath='/private/range';
  const published=prepareOfficialCatalog([record],record.id,'range-fixture',2);
  assert.deepEqual(published.templates[0].layouts.landscape.distributions,restored.layouts.landscape.distributions);
  assert.ok(!JSON.stringify(published).includes('/private/range'));
  assert.ok(builtInTemplateChanges(record).some(change=>change.field==='分布范围'&&change.localValue.includes('60%')));
});
test('local range edits survive an orientation switch with valid members',()=>{
  const base=fixture(),record={...structuredClone(template),layouts:{landscape:base,portrait:structuredClone(base)}};
  const edited=structuredClone(base);setDistributionRange(edited,a,ids(edited),'x',{reference:'canvas',ratio:.6},size);
  const rotated={...a,crop:{x:0,y:0,width:1,height:1,rotation:90}};
  const next=resolveDocumentLayout(reorientTemplateDocument(record,a,rotated,edited),rotated,size);
  assert.equal(next.distributions[0].range.ratio,.6);assert.ok(isValidEditorDocument(next));near(metrics(next,rotated,'x').ratio,.6);
});
test('invalid ranges are rejected without changing legacy rule validation',()=>{
  const doc=fixture();setDistributionRange(doc,a,ids(doc),'x',{reference:'canvas',ratio:.6},size);
  for(const range of [null,{}, {reference:'selection',ratio:.6,anchor:.5}, ...[0,-.1,1.1,NaN,Infinity].map(ratio=>({reference:'canvas',ratio,anchor:.5})), ...[NaN,Infinity,1e40].map(anchor=>({reference:'canvas',ratio:.6,anchor}))]) {
    const invalid=structuredClone(doc);invalid.distributions[0].range=range;assert.equal(isValidEditorDocument(invalid),false);
  }
  const two=fixture('x',2);two.distributions=[{axis:'x',layerIds:ids(two)}];assert.equal(isValidEditorDocument(two),false);
});

for (const axis of ['x','y']) test(`${axis} line rejects resizing the perpendicular dimension`,()=>{
  const doc=fixture(axis),before=structuredClone(doc);
  setDistributionRange(doc,a,ids(doc),axis==='x'?'y':'x',{reference:'canvas',ratio:.6},size);
  assert.deepEqual(doc,before,'Range editing must not turn a row into a column or a column into a row');
});
test('mixed selections reject range editing without moving any element',()=>{
  const doc=fixture();doc.layers.forEach((layer,i)=>{layer.y=.2+i*.2;});
  const before=structuredClone(doc);
  for (const axis of ['x','y']) {
    setDistributionRange(doc,a,ids(doc),axis,{reference:'canvas',ratio:.6},size);
    assert.deepEqual(doc,before,'A mixed selection must be aligned before resizing its range');
  }
});
test('line detection tolerates small placement errors and recognizes unequal font sizes aligned at the edge',()=>{
  const doc=fixture();doc.layers[1].y+=.0005;
  assert.equal(selectionLineAxis(measured(doc,a)),'x');
  const row=measured(fixture(),a);
  row[1].bounds.height*=2;row[1].bounds.y-=row[1].bounds.height/2;row[1].position.y-=row[1].bounds.height/4;
  assert.equal(selectionLineAxis(row),'x','Aligned bottoms with different heights still form one row');
});
test('grids, diagonal pairs and completely overlapping elements have no adjustable line axis',()=>{
  const doc=fixture('x',4);doc.layers.forEach((layer,i)=>{layer.x=.2+(i%2)*.2;layer.y=.2+Math.floor(i/2)*.2;});
  assert.equal(selectionLineAxis(measured(doc,a)),null);
  doc.layers=doc.layers.slice(0,2);doc.layers[1].y+=.2;
  assert.equal(selectionLineAxis(measured(doc,a)),null);
  doc.layers[1].x=doc.layers[0].x;doc.layers[1].y=doc.layers[0].y;
  assert.equal(selectionLineAxis(measured(doc,a)),null);
});
test('resizing a column preserves its width, x coordinates and font properties',()=>{
  const doc=fixture('y'),before=structuredClone(doc),width=metrics(doc,a,'x').bounds.width;
  setDistributionRange(doc,a,ids(doc),'y',{reference:'canvas',ratio:.7},size);
  near(metrics(doc,a,'x').bounds.width,width);
  doc.layers.forEach((layer,i)=>{near(layer.x,before.layers[i].x);assert.equal(layer.fontSize,before.layers[i].fontSize);assert.equal(layer.rotation,before.layers[i].rotation);});
  assert.equal(selectionLineAxis(measured(doc,a)),'y');
});

for (const axis of ['x','y']) test(`${axis} range preserves the perpendicular coordinate in a collapsed region`,()=>{
  const doc=fixture(axis),region=axis==='x'?'bottom':'left',other=axis==='x'?'y':'x';
  doc.frame[axis==='x'?'paddingY':'paddingX']=0;
  doc.regions[region]={enabled:true,extra:0,safePadding:0,direction:0};
  doc.layers.forEach(layer=>{layer.region=region;layer[other]=.37;});
  setDistributionRange(doc,a,ids(doc),axis,{reference:'canvas',ratio:.6},size);
  assert.ok(doc.distributions?.[0].range);
  for(let i=0;i<3;i++) {
    const next=resolveDocumentLayout(doc,a,size);next.layers.forEach(layer=>near(layer[other],.37));
    Object.assign(doc,next);
  }
  doc.frame[axis==='x'?'paddingY':'paddingX']=5;
  const next=resolveDocumentLayout(doc,a,size),geometry=calculateGeometry(a,next),rect=geometry.regions[region];
  next.layers.forEach(layer=>near(layerPosition(layer,geometry)[other],rect[other]+.37*rect[other==='x'?'width':'height']));
  near(metrics(next,a,axis).ratio,.6);
});

for (const axis of ['x','y']) for(const padding of [0,.05]) test(`${axis} range rejects an unpositionable axis at padding ${padding}`,()=>{
  const doc=fixture(axis,2),regions=axis==='x'?['left','right']:['top','bottom'];
  doc.frame[axis==='x'?'paddingX':'paddingY']=padding;
  regions.forEach(region=>{doc.regions[region]={enabled:true,extra:0,safePadding:0,direction:0};});
  doc.layers.forEach((layer,i)=>{layer.region=regions[i];layer.x=.5;layer.y=.5;});
  const before=structuredClone(doc);
  setDistributionRange(doc,a,ids(doc),axis,{reference:'canvas',ratio:.6},size);
  assert.deepEqual(doc,before,'Rejected range must not persist a rule or invalid normalized coordinates');
});

for(const axis of ['x','y']) test(`${axis} saved range and alignment survive collapsing and restoring the active region`,()=>{
  const doc=fixture(axis,2),regions=axis==='x'?['left','right']:['top','bottom'],padding=axis==='x'?'paddingX':'paddingY';
  doc.frame[padding]=5;regions.forEach(region=>{doc.regions[region]={enabled:true,extra:0,safePadding:0,direction:0};});
  doc.layers.forEach((layer,i)=>{layer.region=regions[i];layer.x=.5;layer.y=.5;});
  setDistributionRange(doc,a,ids(doc),axis,{reference:'canvas',ratio:.6},size);
  arrange(doc,a,axis==='x'?'left':'top');arrange(doc,a,axis==='x'?'center-y':'center-x');
  const before=resolveDocumentLayout(doc,a,size),collapsed=structuredClone(before);collapsed.frame[padding]=0;
  const next=resolveDocumentLayout(collapsed,a,size);
  assert.deepEqual(next.layers,collapsed.layers,'Resolving a collapsed axis must preserve stored coordinates');
  assert.deepEqual(next.distributions,collapsed.distributions,'Collapsed geometry must not rewrite the saved anchor');
  next.frame[padding]=5;unchanged(before,resolveDocumentLayout(next,a,size),a);
});
