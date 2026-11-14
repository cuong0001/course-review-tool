const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../../review-core.js');
function approved(){const s=C.blank();s.fingerprint='a'.repeat(64);s.checks=Object.fromEntries(Object.keys(C.checks.question).map(k=>[k,true]));C.finalize(s,'question','approve');return s;}
test('approval requires every check and resolved flags',()=>{const s=C.blank();assert.throws(()=>C.finalize(s,'question','approve'));Object.assign(s,approved(),{flag:true});assert.throws(()=>C.finalize(s,'question','approve'));});
test('notes and flags invalidate finalized decisions',()=>{for(const [k,v]of [['notes','Fix'],['flag',true],['sections',{block:'Fix'}],['checks',{}]]){const s=approved();C.edit(s,k,v);assert.equal(s.decision,null);assert.equal(s.decided_at,null);}});
test('unfinished work never exports as a decision; changed sources excluded',()=>{const s=approved(),k='question:q';assert.equal(C.decisions('An',{[k]:s},{[k]:{kind:'question',id:'q',fingerprint:'b'.repeat(64)}}).decisions.length,0);C.edit(s,'notes','draft');assert.equal(C.decisions('An',{[k]:s},{[k]:{kind:'question',id:'q',fingerprint:s.fingerprint}}).decisions.length,0);});
test('section notes survive JSON round trip and become comments',()=>{const s=approved();s.sections={intro:'Sửa ví dụ'};const p={format:'course-review-package',version:1,reviewer:'Hieu',exported_at:new Date().toISOString(),items:[{item_type:'question',id:'q',state:s}]};const restored=C.validatePackage(JSON.parse(JSON.stringify(p)));assert.match(C.comment(restored.items[0].state),/\[intro\] Sửa ví dụ/);});
test('malformed and duplicate imports rejected',()=>{assert.throws(()=>C.validatePackage({}));const p={format:'course-review-package',version:1,reviewer:'An',exported_at:new Date().toISOString(),items:[{item_type:'question',id:'q',state:approved()}]};p.items.push(p.items[0]);assert.throws(()=>C.validatePackage(p));});
test('source-only staleness preserves decision, original decided_at, notes, flag, and content checks while excluding from fresh decisions until confirmed',()=>{
  const s=approved();s.notes='Keep note';s.sections={stem:'Check wording'};const origDecided=s.decided_at;
  C.markSourcesStale(s);
  assert.equal(s.decision,'approve');assert.equal(s.decided_at,origDecided);assert.equal(s.previous_sources_decided_at,origDecided);
  assert.equal(s.source_recheck_needed,true);assert.equal(s.checks.source_supports,false);
  assert.equal(s.checks.correct_answer,true);assert.equal(s.checks.distractors_explained,true);assert.equal(s.checks.facts_code_accurate,true);
  assert.equal(s.notes,'Keep note');assert.deepEqual(s.sections,{stem:'Check wording'});
  const loaded={'question:q':{kind:'question',id:'q',fingerprint:s.fingerprint}};
  const staleExport=C.decisions('An',{'question:q':s},loaded);
  assert.equal(staleExport.decisions.length,0);
  assert.equal(staleExport.stale_source_decisions.length,1);
  assert.equal(staleExport.stale_source_decisions[0].decided_at,origDecided);
  assert.equal(staleExport.stale_source_decisions[0].source_recheck_needed,true);
  const pkg={format:'course-review-package',version:1,reviewer:'An',exported_at:new Date().toISOString(),items:[{item_type:'question',id:'q',state:s}]};
  assert.equal(C.validatePackage(JSON.parse(JSON.stringify(pkg))).items[0].state.source_recheck_needed,true);
  C.confirmSources(s,'question');
  assert.equal(s.source_recheck_needed,false);assert.equal(s.checks.source_supports,true);
  assert.equal(s.decided_at,origDecided);assert.ok(s.source_rechecked_at);
  const freshExport=C.decisions('An',{'question:q':s},loaded);
  assert.equal(freshExport.decisions.length,1);assert.equal(freshExport.stale_source_decisions.length,0);
  assert.equal(freshExport.decisions[0].decided_at,origDecided);assert.equal(freshExport.decisions[0].source_rechecked_at,s.source_rechecked_at);
});
test('stale approve with source_supports=true or missing content checks is rejected in package validation',()=>{
  const s=approved();s.notes='Keep note';C.markSourcesStale(s);s.checks.source_supports=true;
  const bad={format:'course-review-package',version:1,reviewer:'An',exported_at:new Date().toISOString(),items:[{item_type:'question',id:'q',state:s}]};
  assert.throws(()=>C.validatePackage(bad));
  C.resetForContentChange(s);assert.equal(s.decision,null);assert.equal(s.decided_at,null);assert.equal(s.source_recheck_needed,false);assert.equal(s.notes,'Keep note');
});
