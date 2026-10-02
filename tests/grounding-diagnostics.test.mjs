import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnnotations as validate, resolveAnnotationDeclarations as resolve} from '../src/grounding.js';
const declaration = (overrides = {}) => ({id:'citation',claim_ids:['claim'],relation:'supports',origin:{kind:'saved',revision_id:'revision',association_id:'association'},...overrides});
test('Object citation stores no copied text and accepts objects above passage limits', () => {
  const result=resolve([declaration()], 'x'.repeat(64000));
  assert.deepEqual(result.annotations[0].anchor,{scope:'object'});
  assert.deepEqual(result.diagnostics,[]);
  assert.equal(JSON.stringify(result.annotations).includes('quote'),false);
});
test('Optional unique passage resolves exact UTF16 offsets without mutating input', () => {
  const input=declaration({passage:'240'}),before=structuredClone(input);
  const result=resolve([input],'😀 240 customers');
  assert.deepEqual(result.annotations[0].anchor,{scope:'passage',quote:'240',start:3,end:6});
  assert.deepEqual(input,before);assert.deepEqual(result.diagnostics,[]);
});
test('Absent and repeated optional passages fall back to the same object without a retry', () => {
  for(const [text,reason]of [['Other','passage_not_found'],['240 and 240','passage_ambiguous']]){
    const result=resolve([declaration({passage:'240'})],text);
    assert.deepEqual(result.annotations[0].anchor,{scope:'object'});
    assert.equal(result.diagnostics[0].reason,reason);
    assert.equal(result.diagnostics[0].annotation_id,'citation');
  }
});
test('Stored passage anchors remain strict and old model-authored offsets cannot bypass the contract', () => {
  const stored={...declaration(),anchor:{scope:'passage',quote:'240',start:2,end:5}};
  assert.throws(()=>validate([stored],'😀 240 customers'),/exact UTF-16 span/);
  assert.throws(()=>resolve([{...declaration(),start:3,end:6,quote:'240'}],'😀 240 customers'),/fields/);
  assert.throws(()=>validate([{...declaration(),anchor:{scope:'object',quote:'240'}}],'240'),/span/);
});
test('Fallback cannot bypass invalid claims, identities or provenance', () => {
  for(const bad of [{claim_ids:[]},{claim_ids:['claim','claim']},{origin:{kind:'saved',revision_id:''}},{id:''}])
    assert.throws(()=>resolve([declaration({passage:'absent',...bad})],'240'));
});
