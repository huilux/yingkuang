import test from 'node:test';
import assert from 'node:assert/strict';
import {bundledCatalog} from '../src/builtin-template-catalog.ts';
import {readDefaultTemplateId,readTemplateLibrary,rebaseTemplateLibrary,serializeUserTemplates,templatesKey} from '../src/template-library.ts';
import {remapTemplateReference} from '../src/template-references.ts';
import {migrateSessionTemplateReferences} from '../src/session-storage.ts';

const original=bundledCatalog();
test('an explicit choice of the new official ID survives restarting after an older personal ID collision',()=>{
  const personal={...structuredClone(original.templates[0]),id:'official-new',name:'私人旧模板',builtIn:false};
  const next=structuredClone(original);next.templates.push({...structuredClone(original.templates[0]),id:personal.id,name:'官方新模板'});
  const result=rebaseTemplateLibrary([...original.templates,personal],original,next);
  const source=serializeUserTemplates(result.templates,next,result.overrideBases,personal.id,[{epoch:1,ids:result.idMap}]);
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:key=>key===templatesKey?source:null};
    const library=readTemplateLibrary();
    assert.equal(library.canPersist,true);
    assert.equal(readDefaultTemplateId(library.templates,library.catalog,library.referenceMap),personal.id);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
for(const version of [1,2])test(`legacy v${version} personal IDs that collide with new built-ins retain their style and default`,()=>{
  const personal={...structuredClone(original.templates[0]),builtIn:false,name:'我的旧模板'};
  const key=version===1?'yingkuang-templates-v1':'yingkuang-templates-v2';
  const source=JSON.stringify(version===1?[personal]:{version:2,overrides:[],custom:[personal]});
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:name=>name===key?source:name==='yingkuang-default-template-v1'?personal.id:null};
    const library=readTemplateLibrary();assert.equal(library.canPersist,true);
    const id=readDefaultTemplateId(library.templates,library.catalog,library.referenceMap);
    assert.notEqual(id,personal.id);assert.deepEqual(library.templates.find(t=>t.id===id).layouts,personal.layouts);
    assert.equal(library.templates.find(t=>t.id===id).name,personal.name);
    assert.doesNotThrow(()=>serializeUserTemplates(library.templates,library.catalog,library.overrideBases,id));
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
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
  const serialized=serializeUserTemplates(changed.templates,next,changed.overrideBases,changed.idMap[personal.id],[{epoch:1,ids:changed.idMap}]);
  const previous=globalThis.localStorage;
  try {
    globalThis.localStorage={getItem:key=>key===templatesKey?serialized:null};
    const restored=readTemplateLibrary();assert.equal(restored.canPersist,true);
    assert.deepEqual(restored.templates,changed.templates);
    assert.deepEqual(restored.catalog,next);
    assert.deepEqual(restored.overrideBases,changed.overrideBases);
    assert.equal(remapTemplateReference(personal.id,restored.referenceMigrations),changed.idMap[personal.id],'An old session reference must still resolve if shutdown interrupted session saving');
    const newest=structuredClone(next);newest.templates[0].name='官方第三版';
    const third=rebaseTemplateLibrary(restored.templates,next,newest,restored.overrideBases);
    assert.equal(third.overrideBases[modified.id].name,original.templates[0].name);
    assert.equal(third.templates.find(t=>t.id===modified.id).name,'我的修改');
  } finally {if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('session migration remaps old references once while preserving later official choices, missing photos and documents',()=>{
  const migrations=[{epoch:1,ids:{shared:'local-shared'}},{epoch:2,ids:{'local-shared':'local-again'}}];
  const old={paths:['missing.jpg'],activeTemplate:'shared',templateIdsByPath:{'missing.jpg':'shared'},documentsByPath:{'missing.jpg':original.templates[0].layouts.landscape}};
  const migrated=migrateSessionTemplateReferences(old,migrations);
  assert.equal(migrated.templateIdsByPath['missing.jpg'],'local-again');
  assert.equal(migrated.activeTemplate,'local-again');assert.equal(migrated.templateReferenceEpoch,2);
  assert.deepEqual(migrated.documentsByPath,old.documentsByPath);
  assert.equal(old.templateIdsByPath['missing.jpg'],'shared');
  const chosen={...old,templateReferenceEpoch:1};
  assert.equal(migrateSessionTemplateReferences(chosen,migrations).templateIdsByPath['missing.jpg'],'shared');
  assert.equal(migrateSessionTemplateReferences(migrated,migrations),migrated);
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
