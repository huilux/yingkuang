import test from 'node:test';
import assert from 'node:assert/strict';
import {textKinds} from '../src/text-segments.ts';
function segments(text){
  const result=[];
  for(const {character,kind} of textKinds(text)){
    if(result.at(-1)?.kind===kind) result.at(-1).text+=character;
    else result.push({text:character,kind});
  }
  return result;
}
test('Chinese, connected English words and digits form independent alignment segments',()=>{
  assert.deepEqual(segments('名字ming123'),[{text:'名字',kind:'han'},{text:'ming',kind:'letters'},{text:'123',kind:'numbers'}]);
  assert.deepEqual(segments('ming名字123'),[{text:'ming',kind:'letters'},{text:'名字',kind:'han'},{text:'123',kind:'numbers'}]);
});
test('punctuation, combining accents and spaces retain their word or numeric context',()=>{
  assert.deepEqual(segments('José e\u0301'),[{text:'José e\u0301',kind:'letters'}]);
  for(const value of ['.5','-12.5%','2026-10-17','12:34:56','1/125']) assert.deepEqual(segments(value),[{text:value,kind:'numbers'}]);
  assert.deepEqual(segments('© 名字 ming 123'),[{text:'© 名字 ',kind:'han'},{text:'ming ',kind:'letters'},{text:'123',kind:'numbers'}]);
});
