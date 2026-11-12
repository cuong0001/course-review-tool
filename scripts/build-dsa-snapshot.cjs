/* Build a read-only DSA review snapshot. Canonical data files are never modified. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MEMBERS = ['Cường', 'Hiếu', 'An', 'Hải', 'Huy', 'Khánh'];
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
function build(dataset, previous = null) {
  const read = name => fs.readFileSync(path.join(dataset,name), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
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
  return {version:1,course_id:course.course_id,course_name:'Data Structures and Algorithms',members:MEMBERS,source_sha256,
    summary:{total_questions:questions.length,approved_questions:questions.filter(q=>q.human_review_status==='approved').length,pending_questions:todo.filter(q=>q.human_review_status==='pending').length,revise_questions:todo.filter(q=>q.human_review_status==='revise').length,lessons:lessons.length},
    assignments, records:[...lessons,...todo]};
}
if(require.main===module){
  if(process.argv.length!==3)throw Error('Usage: node scripts/build-dsa-snapshot.cjs PATH_TO_CURATED_DATA');
  const destination=path.resolve(__dirname,'../data/dsa-review-data.js');
  let previous=null;
  if(fs.existsSync(destination)){const vm=require('node:vm');const context={};vm.runInNewContext(fs.readFileSync(destination,'utf8'),context);previous=context.DSAReviewData;}
  const result=build(path.resolve(process.argv[2]),previous);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,'/* Read-only CSC10004 review snapshot. Refresh through scripts/build-dsa-snapshot.cjs. */\nglobalThis.DSAReviewData = '+JSON.stringify(result,null,2)+';\n','utf8');
  const report=['# DSA review assignments','','Read-only CSC10004 allocation. Approved questions are excluded. Assignment ownership is retained when refreshing the snapshot.','','| Member | Questions | Reading guides |','|---|---:|---:|'];
  for(const member of MEMBERS)report.push('| '+member+' | '+result.records.filter(r=>result.assignments.question[r.question_id]===member).length+' | '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).length+' |');
  for(const member of MEMBERS){report.push('','## '+member,'','Questions: '+result.records.filter(r=>result.assignments.question[r.question_id]===member).map(r=>r.question_id).join(', '),'','Reading guides: '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).map(r=>r.lesson_id).join(', '));}
  fs.writeFileSync(path.resolve(__dirname,'../DSA_ASSIGNMENTS.md'),report.join('\n')+'\n','utf8');
  console.log(JSON.stringify(result.summary));
  for(const member of MEMBERS)console.log(member+': '+result.records.filter(r=>result.assignments.question[r.question_id]===member).length+' questions, '+result.records.filter(r=>result.assignments.lesson[r.lesson_id]===member).length+' lessons');
}
module.exports={MEMBERS,build,distribute};
