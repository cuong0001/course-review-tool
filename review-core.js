/* Shared review contract. Classic scripts work when opened directly through file://. */
(function (root) {
  'use strict';
  const checks = {
    lesson: {source_supports:'I opened the source and it supports this',claims_match_source:'Each claim matches the source',code_runs:'Code runs as written',no_copied_passages:'No copied passages'},
    question: {source_supports:'I opened the source and it supports this',correct_answer:'The correct answer is correct',distractors_explained:'Each distractor is wrong for a stated reason',facts_code_accurate:'Facts and code are accurate'},
    video: {source_supports:'I opened the source and it supports this',content_accurate:'Content is accurate and relevant',license_checked:'I checked the license and permitted use'},
    resource: {source_supports:'I opened the source and it supports this',content_accurate:'Content is accurate and relevant',license_checked:'I checked the license and permitted use'},
    activity: {source_supports:'I opened the source and it supports this',facts_code_accurate:'Facts and code are accurate',code_runs:'Code runs as written'}
  };
  const ids={lesson:'lesson_id',question:'question_id',video:'clip_id',resource:'resource_id',activity:'activity_id'};
  const key=(kind,id)=>`${kind}:${id}`;
  const blank=()=>({notes:'',sections:{},flag:false,checks:{},decision:null,decided_at:null,updated_at:null,fingerprint:null});
  function edit(state,field,value){state[field]=value;state.decision=null;state.decided_at=null;state.updated_at=new Date().toISOString();}
  function comment(s){return [s.notes,...Object.entries(s.sections).filter(([,v])=>v.trim()).map(([k,v])=>`[${k}] ${v}`)].filter(Boolean).join('\n\n');}
  function finalize(s,kind,decision){if(!['approve','revise','reject'].includes(decision))throw Error('Invalid decision');if(decision==='approve'&&(s.flag||Object.keys(checks[kind]).some(k=>s.checks[k]!==true)))throw Error('Resolve the flag and tick every check before verifying.');if(decision!=='approve'&&!comment(s).trim())throw Error('Add a note explaining what needs fixing.');s.decision=decision;s.decided_at=new Date().toISOString();s.updated_at=s.decided_at;}
  function decisions(reviewer,states,loaded){return {version:1,reviewer,exported_at:new Date().toISOString(),decisions:Object.entries(states).filter(([k,s])=>s.decision&&loaded[k]&&s.fingerprint===loaded[k].fingerprint).map(([k,s])=>({item_type:loaded[k].kind,id:loaded[k].id,decision:s.decision,comment:comment(s),checks:{...s.checks},decided_at:s.decided_at}))};}
  function validDate(v){return typeof v==='string'&&/T.*(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v));}
  function validatePackage(p){
    if(!p||p.format!=='course-review-package'||p.version!==1||typeof p.reviewer!=='string'||!p.reviewer.trim()||!validDate(p.exported_at)||!Array.isArray(p.items))throw Error('Invalid review package.');
    const seen=new Set();for(const item of p.items){
      if(!item||!Object.hasOwn(ids,item.item_type)||typeof item.id!=='string'||!item.id||seen.has(key(item.item_type,item.id)))throw Error('Unknown type or duplicate review ID.');seen.add(key(item.item_type,item.id));
      const s=item.state;if(!s||typeof s.notes!=='string'||typeof s.flag!=='boolean'||!s.sections||Array.isArray(s.sections)||typeof s.sections!=='object'||Object.values(s.sections).some(v=>typeof v!=='string')||!s.checks||Array.isArray(s.checks)||typeof s.checks!=='object'||Object.values(s.checks).some(v=>typeof v!=='boolean')||typeof s.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.fingerprint))throw Error('Malformed saved review.');
      if(s.updated_at!==null&&!validDate(s.updated_at))throw Error('Invalid review timestamp.');
      if(s.decision!==null){if(!validDate(s.decided_at))throw Error('Invalid decision timestamp.');finalize({...s},item.item_type,s.decision);}
    }return p;
  }
  root.ReviewCore={checks,ids,key,blank,edit,comment,finalize,decisions,validatePackage};
  if(typeof module!=='undefined')module.exports=root.ReviewCore;
})(globalThis);
