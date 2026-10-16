import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInTemplates, calculateGeometry, layerPosition, resolveLayerText } from '../src/editor-model.ts';
import { arrangeSelection } from '../src/selection-model.ts';
import { commitArrangement, resolveDocumentLayout, releaseLayoutRules, pruneLayoutRules } from '../src/document-layout.ts';
import { isValidEditorDocument, builtInTemplateChanges } from '../src/builtin-template-catalog.ts';
import { serializeTemplateBackup, parseTemplateBackup } from '../src/template-library.ts';
import { prepareOfficialCatalog } from '../src/official-templates.ts';

const source = builtInTemplates().find(template => template.id === 'wide-float');
const photoA = {id:'a',width:600,height:400,metadata:{focalLength:'50mm',aperture:'f/2',iso:'ISO100'}};
const photoB = {...photoA,id:'b',width:1600,height:900,metadata:{focalLength:'135mm',aperture:'f/11',iso:'ISO12800'}};
const size = (layer,text) => ({width:Math.max(...text.split('\n').map(line=>line.length*11.73)),height:text.split('\n').length*layer.fontSize});
function fixture(axis='x',rotation=0) {
  const document=structuredClone(source.layouts.landscape);
  const original=document.layers.find(layer=>layer.source==='focalLength');
  document.layers=['focalLength','aperture','iso'].map((source,i)=>({...original,id:String(i),source,rotation,x:axis==='x'?.2+i*.3:.5,y:axis==='y'?.2+i*.3:.5}));
  delete document.distributions; delete document.alignments;
  return document;
}
function arranged(document,photo,action,reference='bottom') {
  const geometry=calculateGeometry(photo,document);
  const measured=document.layers.map(layer=>{
    const s=size(layer,resolveLayerText(layer,photo)), position=layerPosition(layer,geometry);
    const width=layer.rotation?s.height:s.width,height=layer.rotation?s.width:s.height;
    return {id:layer.id,position,bounds:{x:position.x-width/2,y:position.y-height/2,width,height}};
  });
  const next=structuredClone(document);
  commitArrangement(next,arrangeSelection(action,reference,measured,document.layers,geometry,document.regions),action,reference,geometry);
  return next;
}
function unchanged(before,after,photo) {
  const geometry=calculateGeometry(photo,before);
  before.layers.forEach((layer,i)=>{
    const a=layerPosition(layer,geometry),b=layerPosition(after.layers[i],geometry);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8,`Layer ${layer.id} moved: ${JSON.stringify({a,b})}`);
  });
}

for(const axis of ['x','y']) for(const centerFirst of [false,true]) test(`${axis} gaps and group centering survive A/B/A photos in either action order`,()=>{
  const distribute=`distribute-${axis}`,center=`center-${axis}`;
  let document=fixture(axis,axis==='y'?90:0);
  for(const action of centerFirst?[center,distribute]:[distribute,center]) document=arranged(document,photoA,action);
  assert.equal(document.distributions.length,1);assert.equal(document.alignments.length,1);
  for(const photo of [photoB,photoA,photoB]) {
    document=resolveDocumentLayout(document,photo,size);
    unchanged(document,arranged(document,photo,distribute),photo);
    unchanged(document,arranged(document,photo,center),photo);
    unchanged(document,resolveDocumentLayout(document,photo,size),photo);
    const geometry=calculateGeometry(photo,document),bounds=document.layers.map(layer=>{
      const position=layerPosition(layer,geometry),s=size(layer,resolveLayerText(layer,photo));
      const dimension=axis==='x'?(layer.rotation?s.height:s.width):(layer.rotation?s.width:s.height);
      return {start:position[axis]-dimension/2,end:position[axis]+dimension/2};
    }).sort((a,b)=>a.start-b.start);
    assert.ok(Math.abs((bounds[0].start+bounds.at(-1).end)/2-(geometry.regions.bottom[axis]+geometry.regions.bottom[axis==='x'?'width':'height']/2))<1e-8);
    assert.ok(Math.abs((bounds[1].start-bounds[0].end)-(bounds[2].start-bounds[1].end))<1e-8);
    assert.ok(isValidEditorDocument(document));
  }
});
test('whole-group dragging preserves gaps, releases its centering, and uses world units across regions',()=>{
  let document=arranged(arranged(fixture(),photoA,'distribute-x'),photoA,'center-x');
  document.layers[1].region='left';
  const geometry=calculateGeometry(photoA,document);
  const patches=document.layers.map(layer=>({id:layer.id,patch:{x:layer.x+12/geometry.regions[layer.region].width}}));
  releaseLayoutRules(document,patches,geometry);
  assert.equal(document.distributions.length,1);assert.equal(document.alignments,undefined);
  releaseLayoutRules(document,[{id:'1',patch:{x:document.layers[1].x+.1}}],geometry);
  assert.equal(document.distributions,undefined);
});
test('selection alignment and spacing on the same axis replace conflicting rules; the other axis survives',()=>{
  let document=arranged(arranged(fixture(),photoA,'distribute-x'),photoA,'center-y');
  document=arranged(document,photoA,'center-x','selection');
  assert.equal(document.distributions,undefined);assert.equal(document.alignments.length,2);
  document=arranged(document,photoA,'distribute-x');
  assert.equal(document.distributions.length,1);
  assert.deepEqual(document.alignments.map(rule=>rule.action),['center-y']);
});
test('alignment rules survive backup and publication sanitization, and appear in template differences',()=>{
  const document=arranged(arranged(fixture(),photoA,'distribute-x'),photoA,'center-x');
  const template={...structuredClone(source),layouts:{landscape:document}};
  const restored=parseTemplateBackup(serializeTemplateBackup([template],template.id)).templates[0];
  assert.deepEqual(restored.layouts.landscape.alignments,document.alignments);
  template.layouts.landscape.alignments[0].privatePath='/private/alignment';
  const published=prepareOfficialCatalog([template],template.id,'fixture-v2',2);
  assert.deepEqual(published.templates[0].layouts.landscape.alignments,restored.layouts.landscape.alignments);
  assert.ok(!JSON.stringify(published).includes('/private/alignment'));
  assert.ok(builtInTemplateChanges(template).some(change=>change.field==='对齐规则'));
});
test('invalid alignment targets, actions, repeated members and missing layers are rejected',()=>{
  const document=arranged(fixture(),photoA,'center-x');
  for(const patch of [{action:'execute'},{reference:'missing'},{layerIds:[]},{layerIds:['0','0']},{layerIds:['missing']}]) {
    const invalid=structuredClone(document);Object.assign(invalid.alignments[0],patch);
    assert.equal(isValidEditorDocument(invalid),false);
  }
  const duplicate=structuredClone(document);duplicate.alignments.push(structuredClone(duplicate.alignments[0]));
  assert.equal(isValidEditorDocument(duplicate),false);
  document.layers.pop();pruneLayoutRules(document);assert.equal(document.alignments,undefined);
});
