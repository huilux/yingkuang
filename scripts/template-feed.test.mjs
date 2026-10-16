import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {parseOfficialCatalog,parseTemplateIndex,unpackOfficialTemplates,officialTemplateConfig,prepareOfficialCatalog} from '../src/official-templates.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const pack=JSON.parse(read('../template-feed/releases/2026.10.1/official-templates.json'));
test('publishing a personal backup removes embedded photos and all unknown private fields',()=>{
  const {catalog}=unpackOfficialTemplates(pack);
  const source=structuredClone(catalog.templates);
  source[0].cover='data:image/png;base64,cHJpdmF0ZQ==';source[0].privatePath='/private/photo.jpg';
  source[0].layouts.landscape.layers[0].privateMetadata='PRIVATE-CONTENT';
  const result=JSON.stringify(prepareOfficialCatalog(source,catalog.defaultTemplateId,'new-version',2));
  assert.ok(!result.includes('cHJpdmF0ZQ==') && !result.includes('/private/photo.jpg') && !result.includes('PRIVATE-CONTENT'));
});
test('published offline package, feed index and bundled snapshot contain all five templates and six-font-compatible layouts',()=>{
  const {index,catalog}=unpackOfficialTemplates(pack);
  assert.equal(pack.index,read('../template-feed/index.json'));
  assert.equal(pack.signature,read('../template-feed/index.sig').trim());
  assert.equal(createHash('sha256').update(pack.catalog).digest('hex'),index.sha256);
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(officialTemplateConfig.publicKey,'base64')]),type:'spki',format:'der'});
  assert.equal(verify(null,Buffer.from(pack.index),key,Buffer.from(pack.signature,'base64')),true);
  assert.equal(verify(null,Buffer.from(pack.index+' '),key,Buffer.from(pack.signature,'base64')),false);
  assert.equal(catalog.templates.length,5);
  assert.deepEqual(catalog.templates,JSON.parse(read('../src/data/builtin-templates.json')).templates);
  assert.ok(catalog.templates.every(t=>t.builtIn && t.cover==='/demo.jpg' && Object.values(t.layouts).every(doc=>doc.distributions.length)));
});
test('remote feed rejects traversal, oversized payloads, external pictures, local photo covers and imported fonts',()=>{
  const index=JSON.parse(pack.index);
  for(const patch of [{path:'../private.json'},{bytes:2*1024*1024+1},{revision:Infinity},{version:'../x'},{fonts:['Remote Font']}])assert.throws(()=>parseTemplateIndex(JSON.stringify({...index,...patch})));
  for(const mutate of [c=>{c.templates[0].cover='https://example.com/photo.jpg';},c=>{c.templates[0].cover='data:image/png;base64,aA==';},c=>{c.templates[0].layouts.landscape.layers[0].fontFamily='YingkuangFontPrivate';}]) {
    const catalog=JSON.parse(pack.catalog);mutate(catalog);assert.throws(()=>parseOfficialCatalog(JSON.stringify(catalog)));
  }
});
