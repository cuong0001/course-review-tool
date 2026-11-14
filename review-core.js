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
  const blank=()=>({notes:'',sections:{},flag:false,checks:{},decision:null,decided_at:null,updated_at:null,fingerprint:null,content_fingerprint:null,source_recheck_needed:false,previous_sources_decided_at:null,source_rechecked_at:null});
  function edit(state,field,value){state[field]=value;state.decision=null;state.decided_at=null;state.source_recheck_needed=false;state.previous_sources_decided_at=null;state.source_rechecked_at=null;state.updated_at=new Date().toISOString();}
  function markSourcesStale(state){
    const now=new Date().toISOString(),nextChecks={...(state.checks||{})};
    if(Object.hasOwn(nextChecks,'source_supports')||state.decision)nextChecks.source_supports=false;
    state.checks=nextChecks;
    if(state.decision||nextChecks.source_supports===false){
      state.source_recheck_needed=true;
      if(state.decision&&!state.previous_sources_decided_at)state.previous_sources_decided_at=state.decided_at;
    }
    state.source_rechecked_at=null;
    state.updated_at=now;
    return state;
  }
  function resetForContentChange(state){edit(state,'checks',{});return state;}
  function confirmSources(state,kind){
    if(!state.decision)throw Error('No prior decision to confirm.');
    if(state.decision==='approve'&&(state.flag||Object.keys(checks[kind]).some(k=>k!=='source_supports'&&state.checks[k]!==true)))throw Error('Resolve the flag and complete content checks before confirming.');
    const now=new Date().toISOString();
    state.checks={...(state.checks||{}),source_supports:true};
    state.source_recheck_needed=false;
    state.source_rechecked_at=now;
    state.updated_at=now;
    return state;
  }
  function comment(s){return [s.notes,...Object.entries(s.sections).filter(([,v])=>v.trim()).map(([k,v])=>`[${k}] ${v}`)].filter(Boolean).join('\n\n');}
  function finalize(s,kind,decision){if(!['approve','revise','reject'].includes(decision))throw Error('Invalid decision');if(decision==='approve'&&(s.flag||Object.keys(checks[kind]).some(k=>s.checks[k]!==true)))throw Error('Resolve the flag and tick every check before verifying.');if(decision!=='approve'&&!comment(s).trim())throw Error('Add a note explaining what needs fixing.');s.decision=decision;s.decided_at=new Date().toISOString();s.updated_at=s.decided_at;s.source_recheck_needed=false;s.previous_sources_decided_at=null;s.source_rechecked_at=null;}
  function decisions(reviewer,states,loaded){
    const matched=Object.entries(states).filter(([k,s])=>s.decision&&loaded[k]&&s.fingerprint===loaded[k].fingerprint);
    const fmt=([k,s])=>({item_type:loaded[k].kind,id:loaded[k].id,decision:s.decision,comment:comment(s),checks:{...s.checks},decided_at:s.decided_at,...(s.source_recheck_needed?{source_recheck_needed:true,previous_sources_decided_at:s.previous_sources_decided_at||s.decided_at}:{}),...(s.source_rechecked_at?{source_rechecked_at:s.source_rechecked_at,...(s.previous_sources_decided_at?{previous_sources_decided_at:s.previous_sources_decided_at}:{})}:{})});
    return {version:1,reviewer,exported_at:new Date().toISOString(),decisions:matched.filter(([,s])=>!s.source_recheck_needed).map(fmt),stale_source_decisions:matched.filter(([,s])=>Boolean(s.source_recheck_needed)).map(fmt)};
  }
  function validDate(v){return typeof v==='string'&&/T.*(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v));}
  function validatePackage(p){
    if(!p||p.format!=='course-review-package'||p.version!==1||typeof p.reviewer!=='string'||!p.reviewer.trim()||!validDate(p.exported_at)||!Array.isArray(p.items))throw Error('Invalid review package.');
    const seen=new Set();for(const item of p.items){
      if(!item||!Object.hasOwn(ids,item.item_type)||typeof item.id!=='string'||!item.id||seen.has(key(item.item_type,item.id)))throw Error('Unknown type or duplicate review ID.');seen.add(key(item.item_type,item.id));
      const s=item.state;if(!s||typeof s.notes!=='string'||typeof s.flag!=='boolean'||!s.sections||Array.isArray(s.sections)||typeof s.sections!=='object'||Object.values(s.sections).some(v=>typeof v!=='string')||!s.checks||Array.isArray(s.checks)||typeof s.checks!=='object'||Object.values(s.checks).some(v=>typeof v!=='boolean')||typeof s.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.fingerprint))throw Error('Malformed saved review.');
      if(s.content_fingerprint!==undefined&&s.content_fingerprint!==null&&(typeof s.content_fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(s.content_fingerprint)))throw Error('Malformed content fingerprint.');
      if(s.source_recheck_needed!==undefined&&typeof s.source_recheck_needed!=='boolean')throw Error('Malformed source recheck flag.');
      if(s.previous_sources_decided_at!==undefined&&s.previous_sources_decided_at!==null&&!validDate(s.previous_sources_decided_at))throw Error('Invalid previous source decision timestamp.');
      if(s.source_rechecked_at!==undefined&&s.source_rechecked_at!==null&&!validDate(s.source_rechecked_at))throw Error('Invalid source recheck timestamp.');
      if(s.updated_at!==null&&!validDate(s.updated_at))throw Error('Invalid review timestamp.');
      if(s.decision!==null){
        if(!validDate(s.decided_at))throw Error('Invalid decision timestamp.');
        if(!['approve','revise','reject'].includes(s.decision))throw Error('Invalid decision');
        if(s.source_recheck_needed){
          if(s.decision==='approve'&&(s.flag||Object.keys(checks[item.item_type]).some(k=>k!=='source_supports'&&s.checks[k]!==true)||s.checks.source_supports===true))throw Error('Invalid stale-source approval state.');
          if(s.decision!=='approve'&&!comment(s).trim())throw Error('Add a note explaining what needs fixing.');
        }else finalize({...s},item.item_type,s.decision);
      }
    }return p;
  }
  root.ReviewCore={checks,ids,key,blank,edit,markSourcesStale,resetForContentChange,confirmSources,comment,finalize,decisions,validatePackage};
  if(typeof module!=='undefined')module.exports=root.ReviewCore;
})(globalThis);
