import test from 'node:test';
import assert from 'node:assert/strict';
import {bundledCatalog} from '../src/builtin-template-catalog.ts';
import {readDefaultTemplateId,readTemplateLibrary,rebaseTemplateLibrary,serializeUserTemplates,templatesKey} from '../src/template-library.ts';

const original=bundledCatalog();
test('a newer bundled snapshot preserves a colliding personal default and exposes its reference mapping',()=>{
  const older=structuredClone(original);older.revision=0;delete older.revision;delete older.contentVersion;
  const removed=older.templates.shift();older.defaultTemplateId=older.templates[0].id;
  const personal={...structuredClone(removed),builtIn:false,name:'原来的个人默认'};
  const source=serializeUserTemplates([...older.templates,personal],older,{},personal.id);
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:key=>key===templatesKey?source:null};
    const library=readTemplateLibrary();assert.equal(library.canPersist,true);
    const id=readDefaultTemplateId(library.templates,library.catalog,library.referenceMap);
    assert.notEqual(id,personal.id);
    assert.equal(library.templates.find(t=>t.id===id).name,personal.name);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('official update preserves modifications, personal collisions, retired/default templates, and pinned originals',()=>{
  const modified=structuredClone(original.templates[0]);modified.name='我的修改';
  const personal={...structuredClone(original.templates[1]),id:'incoming',builtIn:false,name:'我的模板'};
  const next=structuredClone(original);
  next.templates[0].name='官方新版';
  next.templates.splice(1,1);
  next.defaultTemplateId=next.templates[0].id;
  next.templates.push({...structuredClone(next.templates[0]),id:personal.id,name:'官方新增'});
  const changed=rebaseTemplateLibrary([modified,...original.templates.slice(1),personal],original,next);
  assert.equal(changed.templates.find(t=>t.id===modified.id).name,'我的修改');
  assert.equal(changed.overrideBases[modified.id].name,original.templates[0].name);
  assert.equal(changed.templates.find(t=>t.id===original.templates[1].id).builtIn,false);
  assert.ok(changed.idMap[personal.id]);
  assert.deepEqual(changed.templates.find(t=>t.id===changed.idMap[personal.id]).layouts,personal.layouts);
  const serialized=serializeUserTemplates(changed.templates,next,changed.overrideBases);
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:key=>key===templatesKey?serialized:null};
    const restored=readTemplateLibrary();assert.equal(restored.canPersist,true);
    assert.deepEqual(restored.templates,changed.templates);
    assert.deepEqual(restored.catalog,next);
    assert.deepEqual(restored.overrideBases,changed.overrideBases);
    const newest=structuredClone(next);newest.templates[0].name='官方第三版';
    const third=rebaseTemplateLibrary(restored.templates,next,newest,restored.overrideBases);
    assert.equal(third.overrideBases[modified.id].name,original.templates[0].name);
    assert.equal(third.templates.find(t=>t.id===modified.id).name,'我的修改');
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('legacy v2 overrides migrate without changing source records, even when equal to the current official version',()=>{
  const source=JSON.stringify({version:2,overrides:[original.templates[0]],custom:[]});
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:key=>key==='yingkuang-templates-v2'?source:null};
    const migrated=readTemplateLibrary();assert.equal(migrated.canPersist,true);
    const saved=JSON.parse(serializeUserTemplates(migrated.templates,migrated.catalog,migrated.overrideBases));
    assert.equal(saved.overrides.length,1);
    assert.equal(source,JSON.stringify({version:2,overrides:[original.templates[0]],custom:[]}));
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
