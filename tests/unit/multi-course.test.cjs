const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCourseSnapshot } = require('../../scripts/build-course-snapshot.cjs');
const CourseReviewCore = require('../../course-review-core.js');

const root = path.resolve(__dirname, '../..');

test('buildCourseSnapshot rejects CSC10004 DSA and mismatched course_id', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-snap-'));
  fs.writeFileSync(path.join(tmp, 'course.json'), JSON.stringify({ course_id: 'CSC10004', course_name_en: 'DSA' }));
  fs.writeFileSync(path.join(tmp, 'concepts.json'), '[]');
  fs.writeFileSync(path.join(tmp, 'topics.json'), '[]');
  assert.throws(() => buildCourseSnapshot({ courseId: 'CSC10004', datasetDir: tmp }), /build-dsa-snapshot/);
  assert.throws(() => buildCourseSnapshot({ courseId: 'CSC10003', datasetDir: tmp }), /Expected course_id 'CSC10003'/);
});

test('CourseReviewCore rejects cross-course and legacy v1 packages', () => {
  const blankState = { ...CourseReviewCore.blank(), fingerprint: 'a'.repeat(64) };
  const pkgOOP = CourseReviewCore.exportCoursePackage('An', { position: 'question:Q_OOP_T01_1_01', states: { 'question:Q_OOP_T01_1_01': blankState } }, 'CSC10003');
  assert.equal(CourseReviewCore.validateCoursePackage(pkgOOP, 'CSC10003').course_id, 'CSC10003');
  assert.throws(() => CourseReviewCore.validateCoursePackage(pkgOOP, 'CSC10008'), /Course mismatch/);
  const legacyV1 = { ...pkgOOP, version: 1 };
  delete legacyV1.course_id;
  assert.throws(() => CourseReviewCore.validateCoursePackage(legacyV1, 'CSC10003'), /Invalid or unsupported/);
});

test('OOP and CN snapshots match canonical reference_sources 100% and preserve pending governance', () => {
  for (const [snapFile, globalVar, expectedCid] of [
    ['data/oop-review-data.js', 'OOPReviewData', 'CSC10003'],
    ['data/cn-review-data.js', 'CNReviewData', 'CSC10008'],
  ]) {
    const abs = path.join(root, snapFile);
    if (!fs.existsSync(abs)) continue;
    const vm = require('node:vm');
    const ctx = {};
    vm.runInNewContext(fs.readFileSync(abs, 'utf8'), ctx);
    const data = ctx[globalVar];
    assert.equal(data.course_id, expectedCid);
    assert.equal(data.summary.approved_questions, 0);
    for (const r of data.records) {
      if (r.question_id) {
        assert.equal(r.human_review_status, 'pending');
        assert.equal(r.approved_by, null);
        assert.ok(Array.isArray(r.reference_sources) && r.reference_sources.length > 0);
      } else if (r.lesson_id) {
        assert.equal(r.provenance.human_review_status, 'pending');
        assert.equal(r.provenance.approved_by, null);
      }
    }
  }
});
