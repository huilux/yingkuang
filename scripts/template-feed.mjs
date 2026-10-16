import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,cpSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseOfficialCatalog,parseTemplateIndex,unpackOfficialTemplates,prepareOfficialCatalog} from '../src/official-templates.ts';
import {parseTemplateBackup} from '../src/template-library.ts';
import config from '../src/data/template-update.json' with {type:'json'};
import fonts from '../src/font-catalog.json' with {type:'json'};

const root=fileURLToPath(new URL('../',import.meta.url));
const {values,positionals}=parseArgs({allowPositionals:true,options:{source:{type:'string'},version:{type:'string'},revision:{type:'string'},notes:{type:'string'},key:{type:'string'},output:{type:'string'},feed:{type:'string'},'min-app-version':{type:'string'}}});
const feed=resolve(root,values.feed??'template-feed');
const read=path=>readFileSync(path,'utf8');
const hash=source=>createHash('sha256').update(source).digest('hex');
const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(config.publicKey,'base64')]),format:'der',type:'spki'});
function signingKey() {
  const source=values.key?read(resolve(values.key)):process.env.TEMPLATE_SIGNING_PRIVATE_KEY;
  if(!source) throw new Error('Set TEMPLATE_SIGNING_PRIVATE_KEY or pass --key with the private signing key path');
  const key=createPrivateKey(source);
  if(!createPublicKey(key).export({format:'der',type:'spki'}).equals(publicKey.export({format:'der',type:'spki'}))) throw new Error('Signing key does not match the application public key');
  return key;
}
function envelope(index,signature,catalog) {return JSON.stringify({format:'yingkuang-official-template-package',version:1,index,signature,catalog},null,2)+'\n';}
function validate(directory) {
  const index=read(resolve(directory,'index.json'));
  const signature=read(resolve(directory,'index.sig')).trim();
  const manifest=parseTemplateIndex(index);
  if(!verify(null,Buffer.from(index),publicKey,Buffer.from(signature,'base64'))) throw new Error('Invalid template index signature');
  const source=read(resolve(directory,manifest.path));
  const catalog=parseOfficialCatalog(source);
  if(hash(source)!==manifest.sha256 || Buffer.byteLength(source)!==manifest.bytes || catalog.templates.length!==manifest.templateCount) throw new Error('Template payload does not match signed index');
  for(const version of readdirSync(resolve(directory,'releases'))) {
    const release=resolve(directory,'releases',version);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version)) throw new Error('Invalid release directory');
    const pack=JSON.parse(read(resolve(release,'official-templates.json')));
    unpackOfficialTemplates(pack);
    const metadata=parseTemplateIndex(pack.index);
    if(pack.format!=='yingkuang-official-template-package' || pack.version!==1 || metadata.version!==version || !verify(null,Buffer.from(pack.index),publicKey,Buffer.from(pack.signature,'base64')) || hash(pack.catalog)!==metadata.sha256 || pack.catalog!==read(resolve(release,'templates.json'))) throw new Error(`Invalid historical release ${version}`);
    parseOfficialCatalog(pack.catalog);
  }
  return {index,signature,source,manifest};
}

if(positionals[0]==='prepare') {
  const version=values.version,revision=Number(values.revision);
  if(!version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version) || !Number.isSafeInteger(revision) || revision<1) throw new Error('Provide --version and increasing integer --revision');
  const directory=resolve(feed,'releases',version);
  if(existsSync(directory)) throw new Error('Published template versions are immutable; choose a new version');
  if(existsSync(resolve(feed,'index.json')) && revision<=JSON.parse(read(resolve(feed,'index.json'))).revision) throw new Error('Revision must increase');
  const input=JSON.parse(read(resolve(root,values.source??'src/data/builtin-templates.json')));
  const backup=input.format==='yingkuang-template-backup'?parseTemplateBackup(JSON.stringify(input)):input;
  const prepared=prepareOfficialCatalog(backup.templates,backup.defaultTemplateId,version,revision);
  const templates=prepared.templates;
  const source=JSON.stringify(prepared,null,2)+'\n';
  parseOfficialCatalog(source);
  const used=new Set(templates.flatMap(t=>Object.values(t.layouts).flatMap(doc=>doc.layers.flatMap(l=>l.fontFamily.split(',').map(name=>name.trim())))));
  const index=JSON.stringify({format:'yingkuang-template-feed',schemaVersion:1,revision,version,minAppVersion:values['min-app-version']??'0.5.9-beta.1',path:`releases/${version}/templates.json`,sha256:hash(source),bytes:Buffer.byteLength(source),templateCount:templates.length,notes:values.notes??'',fonts:fonts.filter(font=>used.has(font.family)).map(font=>font.family)},null,2)+'\n';
  parseTemplateIndex(index);
  const signature=sign(null,Buffer.from(index),signingKey()).toString('base64');
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'templates.json'),source);
  writeFileSync(resolve(directory,'official-templates.json'),envelope(index,signature,source));
  writeFileSync(resolve(feed,'index.json'),index);
  writeFileSync(resolve(feed,'index.sig'),signature+'\n');
  validate(feed);
  console.log(`Prepared ${version}: ${templates.length} templates, ${Buffer.byteLength(source)} bytes`);
} else if(positionals[0]==='check') {
  const {manifest}=validate(feed);console.log(`Verified signed template feed ${manifest.version}`);
} else if(positionals[0]==='sync-bundled') {
  validate(feed);
  const version=values.version??JSON.parse(read(resolve(feed,'index.json'))).version;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version))throw new Error('Invalid bundled version');
  const source=read(resolve(feed,'releases',version,'official-templates.json'));
  const pack=JSON.parse(source);
  const {index}=unpackOfficialTemplates(pack);
  writeFileSync(resolve(root,'src/data/builtin-templates.json'),pack.catalog);
  writeFileSync(resolve(root,'src/data/bundled-template-package.json'),source);
  writeFileSync(resolve(root,'src/data/template-update.json'),JSON.stringify({...config,bundledVersion:index.version,bundledRevision:index.revision},null,2)+'\n');
  console.log(`Bundled offline templates now match ${index.version}`);
} else if(positionals[0]==='build') {
  const {index,source,manifest}=validate(feed);
  if(!values.output) throw new Error('Provide --output');
  const output=resolve(root,values.output);
  if(output===feed || output===root || feed.startsWith(output+'/')) throw new Error('Output must be a separate deployment directory');
  mkdirSync(dirname(output),{recursive:true});cpSync(feed,output,{recursive:true});
  const signature=sign(null,Buffer.from(index),signingKey()).toString('base64');
  writeFileSync(resolve(output,'index.sig'),signature+'\n');
  writeFileSync(resolve(output,'releases',manifest.version,'official-templates.json'),envelope(index,signature,source));
  writeFileSync(resolve(output,'.nojekyll'),'');
  writeFileSync(resolve(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>映框官方模板</title><h1>映框官方模板</h1><p>请在映框的模板库中检查更新，或下载官方模板包后离线导入。</p><p><a href="'+manifest.path.replace('templates.json','official-templates.json')+'">下载官方模板包 '+manifest.version+'</a></p><p><a href="https://github.com/huilux/yingkuang">项目仓库</a></p></html>');
  validate(output);console.log(`Built template site ${manifest.version}`);
} else throw new Error('Usage: template-feed.mjs prepare|check|sync-bundled|build [options]');
