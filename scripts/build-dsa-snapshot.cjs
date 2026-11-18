/* Build a read-only DSA review snapshot. Canonical data files are never modified. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ReviewDiff = require('../review-diff.js');
const MEMBERS = ['Cường', 'Hiếu', 'Hải', 'Huy', 'Khánh'];
const byTopic = (a,b) => (a.topic_id || '').localeCompare(b.topic_id || '') || (a.question_id || a.lesson_id).localeCompare(b.question_id || b.lesson_id);
function distribute(records, idField) {
  const assignment = {};
  let offset = 0;
  MEMBERS.forEach((member,index) => {
    const count = Math.floor(records.length / MEMBERS.length) + (index < records.length % MEMBERS.length ? 1 : 0);
    for (const record of records.slice(offset, offset + count)) assignment[record[idField]] = member;
    offset += count;
  });
  return assignment;
}
const readJsonl = (dir,name) => fs.readFileSync(path.join(dir,name), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const hashRecord = r => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
// compare: {dir, label}. Records whose content differs from the same ID in compare.dir get a field-level change
// list, stored beside the records (DSAReviewData.changes) so record fingerprints stay those of the course data.
function changesAgainst(records, compare) {
  const old = new Map();
  for (const r of readJsonl(compare.dir,'question_bank.jsonl')) old.set('question:'+r.question_id, r);
  for (const r of readJsonl(compare.dir,'lesson_content.jsonl')) old.set('lesson:'+r.lesson_id, r);
  const changes = {};
  for (const record of records) {
    const key = record.question_id ? 'question:'+record.question_id : 'lesson:'+record.lesson_id, before = old.get(key);
    if (!before) continue;
    const fields = ReviewDiff.diffRecords(before, record);
    if (fields.length) changes[key] = {compared_with: compare.label,
      status_before: before.human_review_status ?? before.provenance?.human_review_status ?? null,
      approved_by_before: before.approved_by ?? null, version_before: String(before.version ?? before.revision ?? ''),
      source_only: ReviewDiff.isSourceOnlyChange(before, record),
      fingerprint_before: hashRecord(before),
      fields};
  }
  return changes;
}
function priorSourceOnlyHashes(records, dirs) {
  if (!dirs || !dirs.length) return undefined;
  const maps = dirs.map(dir => {
    const m = new Map();
    for (const r of readJsonl(dir,'question_bank.jsonl')) m.set('question:'+r.question_id, r);
    for (const r of readJsonl(dir,'lesson_content.jsonl')) m.set('lesson:'+r.lesson_id, r);
    return m;
  });
  const out = {};
  for (const record of records) {
    const key = record.question_id ? 'question:'+record.question_id : 'lesson:'+record.lesson_id;
    const currentHash = hashRecord(record), seen = new Set();
    for (const m of maps) {
      const before = m.get(key);
      if (!before) continue;
      const beforeHash = hashRecord(before);
      if (beforeHash !== currentHash && ReviewDiff.isSourceOnlyChange(before, record)) seen.add(beforeHash);
    }
    if (seen.size) out[key] = [...seen];
  }
  return Object.keys(out).length ? out : undefined;
}
function build(dataset, previous = null, compare = null, priorDirs = []) {
  const read = name => readJsonl(dataset,name);
  const course = JSON.parse(fs.readFileSync(path.join(dataset,'course.json'),'utf8'));
  if (course.course_id !== 'CSC10004') throw Error('Expected the CSC10004 DSA dataset.');
  const questions = read('question_bank.jsonl');
  const lessons = read('lesson_content.jsonl').sort(byTopic);
  const todo = questions.filter(q => ['pending','revise'].includes(q.human_review_status)).sort((a,b) => Number(a.human_review_status==='revise')-Number(b.human_review_status==='revise') || byTopic(a,b));
  const assignments = {};
  for (const [kind, records, field] of [['question',todo,'question_id'],['lesson',lessons,'lesson_id']]) {
    let mapping = previous?.assignments?.[kind];
    if (!mapping) mapping = distribute(records,field);
    else {
      // Preserve responsibility on refresh; add only newly eligible IDs to the least-loaded member.
      mapping = {...mapping};
      const loads = Object.fromEntries(MEMBERS.map(m=>[m,records.filter(r=>mapping[r[field]]===m).length]));
      for (const record of records) if (!MEMBERS.includes(mapping[record[field]])) {
        const member = [...MEMBERS].sort((a,b)=>loads[a]-loads[b] || MEMBERS.indexOf(a)-MEMBERS.indexOf(b))[0];
        mapping[record[field]] = member; loads[member]++;
      }
    }
    assignments[kind] = mapping;
  }
  const source_sha256 = {};
  for(const name of ['course.json','question_bank.jsonl','lesson_content.jsonl'])source_sha256[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dataset,name))).digest('hex');
  const allRecords = [...lessons,...todo];
  const resolvedPriorDirs = [...new Set([...(compare?.dir ? [compare.dir] : []), ...(priorDirs || [])])];
  const prior_source_only_fingerprints = priorSourceOnlyHashes(allRecords, resolvedPriorDirs);
  return {version:1,course_id:course.course_id,course_name:'Data Structures and Algorithms',members:MEMBERS,source_sha256,
    summary:{total_questions:questions.length,approved_questions:questions.filter(q=>q.human_review_status==='approved').length,pending_questions:todo.filter(q=>q.human_review_status==='pending').length,revise_questions:todo.filter(q=>q.human_review_status==='revise').length,lessons:lessons.length},
    assignments, records:allRecords, ...(previous?.audit_overlay ? {audit_overlay: previous.audit_overlay} : {}), ...(compare ? {changes: changesAgainst(allRecords, compare)} : {}), ...(prior_source_only_fingerprints ? {prior_source_only_fingerprints} : {})};
}
if(require.main===module){
  const args=process.argv.slice(2),flag=name=>{const i=args.indexOf(name);if(i<0)return null;const v=args[i+1];if(!v)throw Error(name+' needs a value');args.splice(i,2);return v;};
  const multiFlag=name=>{const out=[];for(let i=args.indexOf(name);i>=0;i=args.indexOf(name)){const v=args[i+1];if(!v)throw Error(name+' needs a value');args.splice(i,2);for(const part of v.split(','))if(part.trim())out.push(path.resolve(part.trim()));}return out;};
  const compareDir=flag('--compare-with'),compareLabel=flag('--label'),priorDirs=multiFlag('--prior-dir');
  if(args.length!==1)throw Error('Usage: node scripts/build-dsa-snapshot.cjs PATH_TO_CURATED_DATA [--compare-with PATH_TO_PREVIOUS_CURATED_DATA] [--label TEXT] [--prior-dir PATH]');
  const destination=path.resolve(__dirname,'../data/dsa-review-data.js');
  let previous=null;
  if(fs.existsSync(destination)){const vm=require('node:vm');const context={};vm.runInNewContext(fs.readFileSync(destination,'utf8'),context);previous=context.DSAReviewData;}
  const result=build(path.resolve(args[0]),previous,compareDir?{dir:path.resolve(compareDir),label:compareLabel||path.resolve(compareDir)}:null,priorDirs);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,'/* Read-only CSC10004 review snapshot. Refresh through scripts/build-dsa-snapshot.cjs. */\nglobalThis.DSAReviewData = '+JSON.stringify(result,null,2)+';\n','utf8');
  const report=['# DSA review assignments','','Read-only CSC10004 allocation. Approved questions are excluded. Assignment ownership is retained when refreshing the snapshot.','','| Member | Questions | Reading guides |','|---|---:|---:|'];
  for(const member of MEMBERS)report.push('| '+member+' | '+result.records.filter(r=>result.assignments.question[r.question_id]===member).length+' | '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).length+' |');
  for(const member of MEMBERS){report.push('','## '+member,'','Questions: '+result.records.filter(r=>result.assignments.question[r.question_id]===member).map(r=>r.question_id).join(', '),'','Reading guides: '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).map(r=>r.lesson_id).join(', '));}
  fs.writeFileSync(path.resolve(__dirname,'../DSA_ASSIGNMENTS.md'),report.join('\n')+'\n','utf8');
  console.log(JSON.stringify({...result.summary,changed_records:Object.keys(result.changes||{}).length}));
  for(const member of MEMBERS)console.log(member+': '+result.records.filter(r=>result.assignments.question[r.question_id]===member).length+' questions, '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).length+' lessons');
}
module.exports={MEMBERS,build,distribute};
