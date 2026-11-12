/* Assignment helpers are separate from review state and decision exports. */
(function(root){
  'use strict';
  const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function canonical(data,name){return data.members.find(member=>normalized(member)===normalized(name)) || null;}
  function owner(data,item){return data.assignments[item.kind]?.[item.id] || null;}
  function belongs(data,item,name){return owner(data,item)===canonical(data,name) && canonical(data,name)!==null;}
  function counts(data,name){const member=canonical(data,name);return Object.fromEntries(['question','lesson'].map(kind=>[kind,data.records.filter(r=>data.assignments[kind]?.[r[kind==='question'?'question_id':'lesson_id']]===member).length]));}
  root.ReviewAssignments={canonical,owner,belongs,counts};
  if(typeof module!=='undefined')module.exports=root.ReviewAssignments;
})(globalThis);
