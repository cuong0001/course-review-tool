/* Build an isolated, read-only course review snapshot for CSC10003 (OOP) or CSC10008 (CN).
 * Never modifies canonical data files or DSA snapshot files.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ReviewDiff = require('../review-diff.js');

const MEMBERS = ['Cường', 'Hiếu', 'An', 'Hải', 'Huy', 'Khánh'];

const recordId = r => r.question_id || r.lesson_id || r.resource_id || r.activity_id || r.clip_id;
const recordKind = r => {
  if (r.question_id) return 'question';
  if (r.lesson_id) return 'lesson';
  if (r.resource_id) return 'resource';
  if (r.activity_id) return 'activity';
  if (r.clip_id) return 'video';
  throw Error('Unsupported record type in snapshot builder.');
};
const byTopic = (a, b) => {
  const ta = a.topic_id || (a.topic_ids && a.topic_ids[0]) || '';
  const tb = b.topic_id || (b.topic_ids && b.topic_ids[0]) || '';
  return ta.localeCompare(tb) || recordId(a).localeCompare(recordId(b));
};

function readJsonl(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

const hashRecord = r => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');

function distribute(records, idField) {
  const assignment = {};
  let offset = 0;
  MEMBERS.forEach((member, index) => {
    const count = Math.floor(records.length / MEMBERS.length) + (index < records.length % MEMBERS.length ? 1 : 0);
    for (const record of records.slice(offset, offset + count)) assignment[record[idField]] = member;
    offset += count;
  });
  return assignment;
}

function changesAgainst(records, compare) {
  const old = new Map();
  for (const [fname, kind, field] of [
    ['question_bank.jsonl', 'question', 'question_id'],
    ['lesson_content.jsonl', 'lesson', 'lesson_id'],
    ['learning_resources.jsonl', 'resource', 'resource_id'],
    ['activities.jsonl', 'activity', 'activity_id'],
  ]) {
    for (const r of readJsonl(compare.dir, fname)) old.set(`${kind}:${r[field]}`, r);
  }
  const changes = {};
  for (const record of records) {
    const kind = recordKind(record);
    const id = recordId(record);
    const key = `${kind}:${id}`;
    const before = old.get(key);
    if (!before) continue;
    const fields = ReviewDiff.diffRecords(before, record);
    if (fields.length) {
      changes[key] = {
        compared_with: compare.label,
        status_before: before.human_review_status ?? before.provenance?.human_review_status ?? null,
        approved_by_before: before.approved_by ?? null,
        version_before: String(before.version ?? before.revision ?? ''),
        source_only: ReviewDiff.isSourceOnlyChange(before, record),
        fingerprint_before: hashRecord(before),
        fields,
      };
    }
  }
  return changes;
}

function buildCourseSnapshot({ courseId, datasetDir, previous = null, compare = null, auditOverlay = null }) {
  const course = JSON.parse(fs.readFileSync(path.join(datasetDir, 'course.json'), 'utf8'));
  if (course.course_id !== courseId) {
    throw Error(`Expected course_id '${courseId}', got '${course.course_id}'. Refusing to mix courses.`);
  }
  if (courseId === 'CSC10004') {
    throw Error('Use scripts/build-dsa-snapshot.cjs for CSC10004 DSA.');
  }

  const questions = readJsonl(datasetDir, 'question_bank.jsonl');
  const lessons = readJsonl(datasetDir, 'lesson_content.jsonl').sort(byTopic);
  const resources = readJsonl(datasetDir, 'learning_resources.jsonl').sort(byTopic);
  const activities = readJsonl(datasetDir, 'activities.jsonl').sort(byTopic);
  const concepts = JSON.parse(fs.readFileSync(path.join(datasetDir, 'concepts.json'), 'utf8'));
  const topics = JSON.parse(fs.readFileSync(path.join(datasetDir, 'topics.json'), 'utf8'));

  const todoQuestions = questions
    .filter(q => ['pending', 'revise'].includes(q.human_review_status))
    .sort((a, b) => Number(a.human_review_status === 'revise') - Number(b.human_review_status === 'revise') || byTopic(a, b));

  const kindGroups = [
    ['question', todoQuestions, 'question_id'],
    ['lesson', lessons, 'lesson_id'],
    ['resource', resources, 'resource_id'],
    ['activity', activities, 'activity_id'],
  ];

  const assignments = {};
  for (const [kind, records, field] of kindGroups) {
    let mapping = previous?.assignments?.[kind];
    if (!mapping) mapping = distribute(records, field);
    else {
      mapping = { ...mapping };
      const loads = Object.fromEntries(MEMBERS.map(m => [m, records.filter(r => mapping[r[field]] === m).length]));
      for (const record of records) {
        if (!MEMBERS.includes(mapping[record[field]])) {
          const member = [...MEMBERS].sort((a, b) => loads[a] - loads[b] || MEMBERS.indexOf(a) - MEMBERS.indexOf(b))[0];
          mapping[record[field]] = member;
          loads[member]++;
        }
      }
    }
    assignments[kind] = mapping;
  }

  const source_sha256 = {};
  for (const name of ['course.json', 'concepts.json', 'topics.json', 'question_bank.jsonl', 'lesson_content.jsonl', 'learning_resources.jsonl', 'activities.jsonl']) {
    const p = path.join(datasetDir, name);
    if (fs.existsSync(p)) {
      source_sha256[name] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  }

  const allRecords = [...lessons, ...todoQuestions, ...resources, ...activities];
  const snapshotPayload = {
    version: 2,
    course_id: course.course_id,
    course_key: course.course_key || course.course_id.toLowerCase(),
    course_name: course.course_name_en,
    course_name_vi: course.course_name_vi || '',
    dataset_version: String(course.version || '1.0.0'),
    members: MEMBERS,
    source_sha256,
    summary: {
      concepts: concepts.length,
      topics: topics.length,
      total_questions: questions.length,
      approved_questions: questions.filter(q => q.human_review_status === 'approved').length,
      pending_questions: todoQuestions.filter(q => q.human_review_status === 'pending').length,
      revise_questions: todoQuestions.filter(q => q.human_review_status === 'revise').length,
      lessons: lessons.length,
      resources: resources.length,
      activities: activities.length,
    },
    assignments,
    records: allRecords,
    ...(auditOverlay ? { audit_overlay: auditOverlay } : {}),
    ...(compare ? { changes: changesAgainst(allRecords, compare) } : {}),
  };
  return snapshotPayload;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = name => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const v = args[i + 1];
    if (!v) throw Error(name + ' needs a value');
    args.splice(i, 2);
    return v;
  };
  const courseId = flag('--course');
  const datasetDir = flag('--dataset');
  const outputPath = flag('--output');
  const globalName = flag('--global-name') || 'CourseReviewData';
  const compareDir = flag('--compare-with');
  const compareLabel = flag('--label');
  const auditFile = flag('--audit-file');

  if (!courseId || !datasetDir || !outputPath) {
    throw Error('Usage: node scripts/build-course-snapshot.cjs --course CSC10003|CSC10008 --dataset PATH --output PATH [--global-name NAME] [--audit-file PATH]');
  }
  const absOutput = path.resolve(outputPath);
  const absDataset = path.resolve(datasetDir);
  let previous = null;
  if (fs.existsSync(absOutput)) {
    const vm = require('node:vm');
    const ctx = {};
    vm.runInNewContext(fs.readFileSync(absOutput, 'utf8'), ctx);
    previous = ctx[globalName] || null;
  }
  let auditOverlay = null;
  if (auditFile && fs.existsSync(path.resolve(auditFile))) {
    auditOverlay = JSON.parse(fs.readFileSync(path.resolve(auditFile), 'utf8'));
    if (auditOverlay.course_id && auditOverlay.course_id !== courseId) {
      throw Error(`Audit overlay course_id '${auditOverlay.course_id}' != '${courseId}'.`);
    }
  }
  const result = buildCourseSnapshot({
    courseId,
    datasetDir: absDataset,
    previous,
    compare: compareDir ? { dir: path.resolve(compareDir), label: compareLabel || compareDir } : null,
    auditOverlay,
  });
  fs.mkdirSync(path.dirname(absOutput), { recursive: true });
  fs.writeFileSync(
    absOutput,
    `/* Read-only ${courseId} review snapshot. Built via scripts/build-course-snapshot.cjs. */\nglobalThis.${globalName} = ${JSON.stringify(result, null, 2)};\n`,
    'utf8'
  );
  console.log(JSON.stringify({ course_id: result.course_id, output: absOutput, summary: result.summary }, null, 2));
}

module.exports = { MEMBERS, buildCourseSnapshot };
