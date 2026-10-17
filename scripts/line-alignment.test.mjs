import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultDocument, calculateGeometry, layerPosition} from '../src/editor-model.ts';
import {arrangeSelection, positionPatch, unionBounds} from '../src/selection-model.ts';
import {commitArrangement, measureDocumentLayers, resolveDocumentLayout, setDistributionRange, releaseLayoutRules} from '../src/document-layout.ts';
import {isValidEditorDocument} from '../src/builtin-template-catalog.ts';
import {serializeTemplateBackup, parseTemplateBackup} from '../src/template-library.ts';

const photoA={id:'line-a',width:6000,height:4000,metadata:{iso:'ISO100'}};
const photoB={id:'line-b',width:4000,height:6000,metadata:{iso:'ISO12800'}};
const measure=(layer,text)=>({width:text.length*layer.fontSize*.6,height:layer.fontSize});
const ids=['line-0','line-1','line-2'];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(axis) {
  const doc=createDefaultDocument(), base=doc.layers[0];
  doc.frame.paddingX=5;doc.frame.paddingY=5;
  for(const region of Object.values(doc.regions)){region.enabled=true;region.extra=8;}
  delete doc.distributions;delete doc.alignments;
  doc.layers=Array.from({length:4},(_,i)=>({...base,id:`line-${i}`,name:`元素${i}`,source:i===1?'iso':'custom',customValue:['名字','', 'ming 123','保留'][i],fontSize:20+i*9,fontFamily:'Space Mono',fontWeight:400,visible:true,rotation:i===1?90:0,region:i===1?'bottom':'canvas',x:.5,y:.5}));
  const geometry=calculateGeometry(photoA,doc);
  doc.layers.forEach((layer,i)=>Object.assign(layer,positionPatch(layer,{x:axis==='x'?250+i*260:700+i*13,y:axis==='y'?200+i*230:650+i*17},geometry).patch));
  return doc;
}
function align(doc,photo,axis) {
  const next=structuredClone(doc), geometry=calculateGeometry(photo,doc);
  const measured=measureDocumentLayers(doc,photo,measure,ids);
  const action=axis==='x'?'center-y':'center-x';
  const patches=arrangeSelection(action,'selection',measured,doc.layers,geometry,doc.regions);
  commitArrangement(next,patches,action,'selection',geometry);
  return next;
}

for(const axis of ['x','y']) test(`${axis} line alignment changes only the perpendicular coordinate and is repeatable`,()=>{
  const doc=fixture(axis), geometry=calculateGeometry(photoA,doc), before=measureDocumentLayers(doc,photoA,measure,ids);
  const group=unionBounds(before), other=axis==='x'?'y':'x', dimension=other==='x'?'width':'height';
  const target=group[other]+group[dimension]/2;
  const aligned=align(doc,photoA,axis);
  aligned.layers.forEach((layer,i)=>{
    if(!ids.includes(layer.id)){assert.deepEqual(layer,doc.layers[i]);return;}
    const position=layerPosition(layer,geometry);
    near(position[other],target);near(position[axis],before[i].position[axis]);
    const {x,y,...style}=layer,{x:oldX,y:oldY,...oldStyle}=doc.layers[i];
    assert.deepEqual(style,oldStyle);
  });
  assert.deepEqual(align(aligned,photoA,axis),aligned);
  assert.equal(isValidEditorDocument(aligned),true);
  for(const photo of [photoB,photoA]) {
    const resolved=resolveDocumentLayout(aligned,photo,measure), measured=measureDocumentLayers(resolved,photo,measure,ids);
    measured.forEach(item=>near(item.position[other],measured[0].position[other]));
    assert.deepEqual(align(resolved,photo,axis),resolved);
  }
});

for(const axis of ['x','y']) test(`${axis} fixed range survives line alignment while conflicting perpendicular rules are released`,()=>{
  let doc=align(fixture(axis),photoA,axis);
  assert.equal(setDistributionRange(doc,photoA,ids,axis,{reference:'canvas',ratio:.6},measure),true);
  const geometry=calculateGeometry(photoA,doc), other=axis==='x'?'y':'x';
  const moved=doc.layers[1], point=layerPosition(moved,geometry);
  const patches=[positionPatch(moved,{...point,[other]:point[other]+23},geometry)];
  // Simulate moving one member out of its line through the normal edit path.
  releaseLayoutRules(doc,patches,geometry);Object.assign(moved,patches[0].patch);
  const range=structuredClone(doc.distributions), before=ids.map(id=>layerPosition(doc.layers.find(layer=>layer.id===id),geometry)[axis]);
  doc=align(doc,photoA,axis);
  assert.deepEqual(doc.distributions,range);
  ids.forEach((id,i)=>near(layerPosition(doc.layers.find(layer=>layer.id===id),geometry)[axis],before[i]));
  const template={id:'line-fixture',name:'行列对齐',description:'',builtIn:false,cover:'/demo.jpg',updatedAt:0,layouts:{landscape:doc}};
  const restored=parseTemplateBackup(serializeTemplateBackup([template],template.id)).templates[0].layouts.landscape;
  assert.deepEqual(restored,doc);
  for(const photo of [photoB,photoA]) {
    const resolved=resolveDocumentLayout(restored,photo,measure);
    const actual=measureDocumentLayers(resolved,photo,measure,ids);
    actual.forEach(item=>near(item.position[other],actual[0].position[other]));
    assert.deepEqual(align(resolved,photo,axis),resolved);
    assert.equal(isValidEditorDocument(resolved),true);
  }
});

test('two elements can align; a collapsed required region cannot silently rewrite coordinates',()=>{
  const doc=fixture('x'), geometry=calculateGeometry(photoA,doc), pair=measureDocumentLayers(doc,photoA,measure,ids.slice(0,2));
  assert.equal(arrangeSelection('center-y','selection',pair,doc.layers,geometry,doc.regions).length,2);
  geometry.regions.bottom.height=0;
  assert.deepEqual(arrangeSelection('center-y','selection',pair,doc.layers,geometry,doc.regions),[]);
  assert.equal(arrangeSelection('center-x','selection',pair,doc.layers,geometry,doc.regions).length,2);
});
