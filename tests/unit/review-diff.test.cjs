const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const D = require('../../review-diff.js');
const {build} = require('../../scripts/build-dsa-snapshot.cjs');

const question = (over = {}) => ({question_id: 'Q_T05_1_01', topic_id: 'T05_1', stem: 'Runs in `Theta(n^2)` time.',
  options: [{option_id: 'A', text: 'O(n)'}, {option_id: 'B', text: 'O(n^2)'}], correct_option_id: 'B', answer_explanation: 'Two loops.',
  distractor_explanations: {A: 'Too small.'}, human_review_status: 'pending', approved_by: null, approved_at: null, version: '1.0.0', ...over});

test('diffRecords lists content changes with readable labels and ignores review metadata', () => {
  const before = question({human_review_status: 'approved', approved_by: 'An', version: '1.0.0'});
  const after = question({stem: String.raw`Runs in $\Theta(n^2)$ time.`, options: [{option_id: 'A', text: '$O(n)$'}, {option_id: 'B', text: 'O(n^2)'}], version: '1.0.1', reviewer_comment: 'note'});
  const fields = D.diffRecords(before, after);
  assert.deepEqual(fields.map(f => f.label), ['stem', 'option A']);
  assert.equal(fields[0].before, 'Runs in `Theta(n^2)` time.');
  assert.deepEqual(D.diffRecords(before, before), []);
});

test('lesson paths are labelled by block id', () => {
  const before = {lesson_id: 'L', blocks: [{id: 'T05-table', type: 'complexity_table', rows: [{worst_bound: 'O(n)'}]}]};
  const after = {lesson_id: 'L', blocks: [{id: 'T05-table', type: 'complexity_table', rows: [{worst_bound: '$O(n)$'}]}]};
  assert.equal(D.diffRecords(before, after)[0].label, 'block T05-table rows 0 worst bound');
});

test('word diff keeps unchanged text and marks only the edited tokens', () => {
  const parts = D.words('takes `Theta(n)` time', String.raw`takes $\Theta(n)$ time`);
  assert.equal(parts.filter(p => p.op !== 'ins').map(p => p.text).join(''), 'takes `Theta(n)` time');
  assert.equal(parts.filter(p => p.op !== 'del').map(p => p.text).join(''), String.raw`takes $\Theta(n)$ time`);
  assert.ok(parts.some(p => p.op === 'same' && p.text.includes('time')));
  assert.deepEqual(D.words('same', 'same'), [{op: 'same', text: 'same'}]);
});

test('snapshot builder records changes against an older dataset without altering records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-build-'));
  const write = (sub, questions) => {
    const d = path.join(dir, sub); fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'course.json'), JSON.stringify({course_id: 'CSC10004'}));
    fs.writeFileSync(path.join(d, 'question_bank.jsonl'), questions.map(q => JSON.stringify(q)).join('\n') + '\n');
    fs.writeFileSync(path.join(d, 'lesson_content.jsonl'), '');
    return d;
  };
  const old = write('old', [question({human_review_status: 'approved', approved_by: 'An'}), question({question_id: 'Q_T05_1_02'})]);
  const changed = question({stem: String.raw`Runs in $\Theta(n^2)$ time.`, version: '1.0.1'});
  const now = write('new', [changed, question({question_id: 'Q_T05_1_02'})]);
  const snapshot = build(now, null, {dir: old, label: 'run X'});
  assert.deepEqual(Object.keys(snapshot.changes), ['question:Q_T05_1_01']);
  const c = snapshot.changes['question:Q_T05_1_01'];
  assert.equal(c.status_before, 'approved'); assert.equal(c.approved_by_before, 'An'); assert.equal(c.compared_with, 'run X');
  assert.deepEqual(c.fields.map(f => f.path), ['stem']);
  assert.deepEqual(snapshot.records.find(r => r.question_id === 'Q_T05_1_01'), changed);
  assert.equal(build(now, null).changes, undefined);
});
