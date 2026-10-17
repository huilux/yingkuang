import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fontGlyphCoverage} from '../src/font-glyphs.ts';
import catalog from '../src/font-catalog.json' with {type:'json'};
import {unicodeCmap6Font} from './font-test-fixtures.js';

for(const font of catalog) for(const file of font.files) test(`actual ${file.path} cmap resolves Latin and Chinese fallback coverage`,()=>{
  const bytes=readFileSync(new URL(`../public/fonts/${file.path}`,import.meta.url));
  const hasGlyph=fontGlyphCoverage(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(hasGlyph('m'),true);
  assert.equal(hasGlyph('名'),font.family==='Long Cang');
  assert.equal(hasGlyph('字'),font.family==='Long Cang');
  assert.equal(hasGlyph('\u{10ffff}'),false);
});
test('incomplete and unknown font indexes fail without out-of-bounds reads',()=>{
  for(const length of [0,4,11,12]) assert.throws(()=>fontGlyphCoverage(new ArrayBuffer(length)),/字形索引/);
});

test('Unicode BMP format 6 fonts retain their glyph coverage',()=>{
  // A trimmed Unicode cmap is valid for imported TTF/OTF fonts too.
  const bytes=new ArrayBuffer(52), data=new DataView(bytes);
  data.setUint16(4,1); data.setUint32(12,0x636d6170);
  data.setUint32(20,28); data.setUint32(24,24);
  data.setUint16(30,1); data.setUint16(32,3); data.setUint16(34,1); data.setUint32(36,12);
  data.setUint16(40,6); data.setUint16(42,12); data.setUint16(46,109); data.setUint16(48,1); data.setUint16(50,7);
  const has=fontGlyphCoverage(bytes);
  assert.equal(has('m'),true); assert.equal(has('n'),false); assert.equal(has('名'),false);
  data.setUint16(50,0); assert.equal(has('m'),false);
});

test('actual imported cmap6 font keeps ASCII coverage without claiming missing Chinese',()=>{
  const source=readFileSync(new URL('../public/fonts/spacemono/SpaceMono-Regular.ttf',import.meta.url));
  const bytes=unicodeCmap6Font(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
  const has=fontGlyphCoverage(bytes);
  for(const character of 'ming123') assert.equal(has(character),true);
  assert.equal(has('名'),false);
});

for(const format of [0,2,10]) test(`Unicode cmap ${format} covers only mapped nonzero glyphs`,()=>{
  const length=format===0?262:format===2?530:24, bytes=new ArrayBuffer(40+length), data=new DataView(bytes);
  data.setUint16(4,1); data.setUint32(12,0x636d6170); data.setUint32(20,28); data.setUint32(24,12+length);
  data.setUint16(30,1); data.setUint32(36,12); data.setUint16(40,format);
  if(format===0){data.setUint16(42,length);data.setUint8(46+109,7);}
  else if(format===2){data.setUint16(42,length);data.setUint16(40+518,109);data.setUint16(40+520,2);data.setInt16(40+522,-1);data.setUint16(40+524,2);data.setUint16(40+526,8);}
  else{data.setUint32(44,length);data.setUint32(52,0x10000);data.setUint32(56,2);data.setUint16(60,7);}
  const has=fontGlyphCoverage(bytes), present=format===10?'\u{10000}':'m';
  assert.equal(has(present),true); assert.equal(has('n'),false);assert.equal(has('\u{10001}'),false);
  data.setUint32(24,12+length-1);
  assert.throws(()=>fontGlyphCoverage(bytes),/字形索引/);
});
