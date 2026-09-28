import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnnotations as validate} from '../src/grounding.js';
const annotation = (overrides = {}) => ({id:'span',start:3,end:6,quote:'240',claim_ids:['claim'],relation:'supports',origin:{kind:'saved',revision_id:'revision',association_id:'association'},...overrides});
test('Incorrect unique quote offsets return exact UTF-16 guidance without changing the annotation', () => {
  const text='😀 240 customers';
  const invalid=annotation({start:2,end:5});const before=structuredClone(invalid);
  assert.throws(()=>validate([invalid],text), /exact quote occurs at UTF-16 \[3, 6\)/);
  assert.deepEqual(invalid,before);
  assert.deepEqual(validate([annotation()],text),[annotation()]);
});
test('Absent and repeated quotes do not suggest an arbitrary location', () => {
  assert.throws(()=>validate([annotation({quote:'250'})],'😀 240 customers'),/quote is absent/);
  assert.throws(()=>validate([annotation({start:1,end:4})],'240 and 240'),/quote occurs more than once/);
});
test('Correct quote offsets cannot bypass invalid provenance', () => {
  assert.throws(()=>validate([annotation({origin:{kind:'saved',revision_id:''}})],'😀 240 customers'),/origin/);
});
