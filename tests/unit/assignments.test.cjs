const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const A=require('../../review-assignments.js');
const {build,MEMBERS}=require('../../scripts/build-dsa-snapshot.cjs');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../data/dsa-review-data.js'),'utf8'),context);
const data=JSON.parse(JSON.stringify(context.DSAReviewData));
test('DSA snapshot excludes all 229 approved questions and covers remaining work once',()=>{
 assert.equal(data.course_id,'CSC10004');assert.equal(data.summary.approved_questions,229);
 const questions=data.records.filter(r=>r.question_id),lessons=data.records.filter(r=>r.lesson_id);
 assert.equal(questions.length,347);assert.equal(lessons.length,21);
 assert.equal(new Set(questions.map(r=>r.question_id)).size,347);
 assert.ok(questions.every(q=>['pending','revise'].includes(q.human_review_status)));
 for(const r of data.records){const item={kind:r.question_id?'question':'lesson',id:r.question_id||r.lesson_id};assert.equal(MEMBERS.filter(name=>A.belongs(data,item,name)).length,1);}
});
test('six exact names have balanced explicit assignments',()=>{
 assert.deepEqual(data.members,MEMBERS);
 assert.deepEqual(MEMBERS.map(name=>A.counts(data,name).question),[58,58,58,58,58,57]);
 assert.deepEqual(MEMBERS.map(name=>A.counts(data,name).lesson),[4,4,4,3,3,3]);
 assert.equal(A.canonical(data,'Hieu'),'Hiếu');assert.equal(A.canonical(data,'Cuong'),'Cường');
 assert.equal(A.belongs(data,{kind:'question',id:'not_assigned'},'An'),false);
});
test('refresh preserves assignments and removes newly approved content from work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assignment-build-'));
 try{
  fs.writeFileSync(path.join(dir,'course.json'),JSON.stringify({course_id:'CSC10004'}));
  const rows=[{question_id:'q1',topic_id:'t',human_review_status:'pending'},{question_id:'q2',topic_id:'t',human_review_status:'pending'},{question_id:'q3',topic_id:'t',human_review_status:'approved'}];
  fs.writeFileSync(path.join(dir,'lesson_content.jsonl'),JSON.stringify({lesson_id:'l1',topic_id:'t'})+'\n');
  const write=()=>fs.writeFileSync(path.join(dir,'question_bank.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');write();const first=build(dir);
  rows[0].human_review_status='approved';rows.push({question_id:'q4',topic_id:'a',human_review_status:'pending'});write();const refreshed=build(dir,first);
  assert.equal(refreshed.assignments.question.q2,first.assignments.question.q2);
  assert.ok(MEMBERS.includes(refreshed.assignments.question.q4));
  assert.equal(refreshed.records.some(r=>r.question_id==='q1'),false);
  assert.deepEqual(build(dir,refreshed),refreshed);
 }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true});}
});
