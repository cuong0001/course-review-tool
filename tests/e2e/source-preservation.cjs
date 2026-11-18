/* Isolated Playwright tests verifying source-only vs substantive review-state preservation across all 9 required scenarios. */
const {chromium} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {build} = require('../../scripts/build-dsa-snapshot.cjs');

const sha = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const root = path.resolve(__dirname, '../..');

function writeDataset(dir, questions, lessons) {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'course.json'), JSON.stringify({course_id: 'CSC10004'}));
  fs.writeFileSync(path.join(dir, 'question_bank.jsonl'), questions.map(q => JSON.stringify(q)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'lesson_content.jsonl'), lessons.map(l => JSON.stringify(l)).join('\n') + '\n');
}

function makeApp(baseDir, data) {
  const app = path.join(baseDir, 'app');
  fs.mkdirSync(path.join(app, 'data'), {recursive: true});
  for (const f of ['review.css', 'review-core.js', 'review-diff.js', 'review-renderers.js', 'review-assignments.js', 'review.js']) {
    fs.copyFileSync(path.join(root, f), path.join(app, f));
  }
  fs.cpSync(path.join(root, 'vendor'), path.join(app, 'vendor'), {recursive: true});
  fs.cpSync(path.join(root, 'review-pages'), path.join(app, 'review-pages'), {recursive: true});
  writeSnapshot(app, data);
  return app;
}

function writeSnapshot(app, data) {
  fs.writeFileSync(path.join(app, 'data/dsa-review-data.js'), 'globalThis.DSAReviewData = ' + JSON.stringify(data) + ';\n');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-source-preserve-'));
  const baseQ = n => ({
    question_id: `Q_T01_1_0${n}`, topic_id: 'T01_1',
    stem: `Question ${n}: asymptotic complexity of linear scan?`,
    options: [{option_id: 'A', text: '$O(1)$'}, {option_id: 'B', text: '$O(n)$'}],
    correct_option_id: 'B', answer_explanation: `Scans ${n} elements once.`,
    distractor_explanations: {A: 'Must visit all elements in worst case.'},
    human_review_status: 'pending', approved_by: null, approved_at: null, version: '1.0.0',
    reference_sources: [`https://example.org/old-${n}`]
  });
  const baseLesson = {
    lesson_id: 'L_T01_1', topic_id: 'T01_1', title: 'Intro Lesson',
    blocks: [{id: 'sec-1', type: 'concept', body_md: 'Original body.', title: 'Concept'}],
    reference_sources: ['https://example.org/lesson-old'], version: '1.0.0'
  };

  // V1 baseline dataset
  const q1 = baseQ(1), q2 = baseQ(2), q3 = baseQ(3), q4 = baseQ(4), q5 = baseQ(5), q6 = baseQ(6);
  const d1 = path.join(tmp, 'v1');
  writeDataset(d1, [q1, q2, q3, q4, q5, q6], [baseLesson]);
  const snap1 = build(d1);
  // Assign all items to Hải (plus q5, q6 accessible under whole team or explicit assignment)
  for (const q of [q1, q2, q3, q4, q5, q6]) snap1.assignments.question[q.question_id] = 'Hải';
  snap1.assignments.lesson[baseLesson.lesson_id] = 'Hải';

  // V2: source-only changes on q1..q5 and lesson; substantive stem change on q6; leave q4 unchanged in d1->d2 OR test both
  const v2Q = (q, ref, over = {}) => ({...q, reference_sources: [ref], ...over});
  const q1_v2 = v2Q(q1, 'https://example.org/new-1');
  const q2_v2 = v2Q(q2, 'https://example.org/new-2');
  const q3_v2 = v2Q(q3, 'https://example.org/new-3');
  const q4_v2 = v2Q(q4, 'https://example.org/new-4');
  const q5_v2 = v2Q(q5, 'https://example.org/new-5');
  const q6_v2 = {...q6, stem: 'Substantively edited stem?', reference_sources: ['https://example.org/new-6']};
  const lesson_v2 = {...baseLesson, reference_sources: ['https://example.org/lesson-new']};
  const d2 = path.join(tmp, 'v2');
  writeDataset(d2, [q1_v2, q2_v2, q3_v2, q4_v2, q5_v2, q6_v2], [lesson_v2]);

  // V3: intermediate->v3 so q4 can be tested via multi-hop legacy fingerprints (d1 -> d2 -> d3) and q5 from d2 -> d3
  const q4_v3 = v2Q(q4_v2, 'https://example.org/new-4-v3');
  const q5_v3 = v2Q(q5_v2, 'https://example.org/new-5-v3');
  const d3 = path.join(tmp, 'v3');
  writeDataset(d3, [q1_v2, q2_v2, q3_v2, q4_v3, q5_v3, q6_v2], [lesson_v2]);
  const snap3 = build(d3, snap1, {dir: d2, label: 'v2'}, [d1]);

  const app = makeApp(tmp, snap1);
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const context = await browser.newContext({acceptDownloads: true});
    const page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });

    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'dsa.html')).href);
    await page.locator('#reviewer').selectOption('Hải');

    // Scenario 4 & 1 & 2 & 3 & 6 setup on V1:
    // Lesson: section comment + flag
    await page.getByRole('button', {name: 'Add a note for section sec-1'}).click();
    await page.getByLabel('Notes for section sec-1', {exact: true}).fill('Lesson sec note');
    await page.getByLabel('Overall notes / what should be fixed').fill('Lesson overall note');
    await page.locator('#approve').click();

    // Switch to questions and finalize decisions:
    // Q1: approve + note, Q2: revise + note, Q3: reject + note, Q6: approve + note (later content-edited)
    await page.locator('#type').selectOption('question');
    const pickQ = async id => { await page.locator('.rail-tab').hover({force: true}); await page.locator('#queue button', {hasText: id}).click(); await page.mouse.move(900, 600); };

    await pickQ('Q_T01_1_01');
    await page.getByLabel('Overall notes / what should be fixed').fill('Q1 preserved note');
    await page.locator('#approve').click();

    await pickQ('Q_T01_1_02');
    await page.getByLabel('Overall notes / what should be fixed').fill('Q2 needs wording polish');
    await page.locator('#revise').click();

    await pickQ('Q_T01_1_03');
    await page.getByLabel('Overall notes / what should be fixed').fill('Q3 off-topic');
    await page.locator('#reject').click();

    await pickQ('Q_T01_1_06');
    await page.getByLabel('Overall notes / what should be fixed').fill('Q6 keep my note on content change');
    await page.locator('#approve').click();

    // Capture original decided_at timestamps & checks in storage BEFORE V3 upgrade
    const beforeDb = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v1')));
    const origQ1 = beforeDb.people['Hải'].states['question:Q_T01_1_01'].decided_at;
    const origQ2 = beforeDb.people['Hải'].states['question:Q_T01_1_02'].decided_at;
    const origQ3 = beforeDb.people['Hải'].states['question:Q_T01_1_03'].decided_at;
    assert.ok(origQ1 && origQ2 && origQ3);

    // Scenario 7 & 8a: Inject a LEGACY stored state for reviewer 'Hiếu' (no content_fingerprint, no source_recheck_needed)
    // created under V1 (prior_source_only_fingerprints!) for Q4 and Q5, to test legacy migration & reviewer switching.
    await page.evaluate(({q4Hash, q5Hash, q4Rec, q5Rec}) => {
      const db = JSON.parse(localStorage.getItem('course-review-workspaces-v1'));
      const legTime = '2026-11-01T10:00:00.000Z';
      db.people['Hiếu'] = {
        position: 'question:Q_T01_1_04',
        scope: 'all',
        states: {
          'question:Q_T01_1_04': {
            notes: 'Legacy V1 approval note', sections: {s1: 'Sec comment'}, flag: false,
            checks: {source_supports: true, correct_answer: true, distractors_explained: true, facts_code_accurate: true},
            decision: 'approve', decided_at: legTime, updated_at: legTime, fingerprint: q4Hash
          },
          'question:Q_T01_1_05': {
            notes: 'Legacy V2 revise note', sections: {}, flag: true,
            checks: {}, decision: 'revise', decided_at: legTime, updated_at: legTime, fingerprint: q5Hash
          }
        }
      };
      localStorage.setItem('course-review-workspaces-v1', JSON.stringify(db));
    }, {q4Hash: sha(q4), q5Hash: sha(q5_v2)});

    // Upgrade bundled snapshot to V3 (includes d1->d2->d3 multi-hop priors and q6 substantive edit) and reload!
    writeSnapshot(app, snap3);
    await page.reload();
    await page.locator('#item h2').first().waitFor();

    // Verify Scenarios 1, 2, 3, 4, 5 for Hải:
    await page.locator('#type').selectOption('question');
    await pickQ('Q_T01_1_01');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Approved/);
    assert.match(await page.locator('#stale-source-banner').innerText(), /references have changed and need to be checked again/i);
    assert.match(await page.locator('#decision-status').innerText(), /Previous decision: Approved/);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'Q1 preserved note');

    await pickQ('Q_T01_1_02');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Needs changes/);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'Q2 needs wording polish');

    await pickQ('Q_T01_1_03');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Rejected/);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'Q3 off-topic');

    // Verify Lesson section notes & approval survived source-only change:
    await page.locator('#type').selectOption('lesson');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Approved/);
    assert.equal(await page.getByLabel('Notes for section sec-1', {exact: true}).inputValue(), 'Lesson sec note');
    await page.locator('#type').selectOption('question');

    // Scenario 6: Verify substantive content change on Q6 cleared decision while retaining notes!
    await pickQ('Q_T01_1_06');
    assert.equal(await page.locator('#decision-status').textContent(), '');
    assert.equal(await page.locator('#stale-source-banner').count(), 0);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'Q6 keep my note on content change');

    // Verify Scenarios 5 & 9: progress excludes stale items from done, filter 'stale-sources' shows them,
    // 'next unfinished' (`u`) visits stale items, and Decisions JSON separates stale_source_decisions!
    assert.match(await page.locator('#progress').textContent(), /0 \/ 7 done · 4 need source check/);
    await pickQ('Q_T01_1_01');
    await page.locator('#confirm-sources').waitFor();
    await page.keyboard.press('u'); // should advance to Q_T01_1_02 (stale-sources is NOT finished!)
    assert.equal(await page.locator('#item h2').first().textContent(), 'Q_T01_1_02');
    await page.locator('#filter').selectOption('stale-sources');
    assert.equal(await page.locator('#queue button').count(), 3); // Q1, Q2, Q3 in question type
    await page.locator('#filter').selectOption('finished');
    assert.equal(await page.locator('#queue button').count(), 0);
    await page.locator('#filter').selectOption('all');

    let dl = page.waitForEvent('download');
    await page.locator('#view-menu summary').click();
    await page.locator('#decisions').click();
    let f = await dl;
    const decBeforeConfirm = JSON.parse(fs.readFileSync(await f.path(), 'utf8'));
    assert.equal(decBeforeConfirm.decisions.length, 0, 'stale approvals must NOT export as fresh approvals');
    assert.equal(decBeforeConfirm.stale_source_decisions.length, 4);
    assert.equal(decBeforeConfirm.stale_source_decisions.find(d => d.id === 'Q_T01_1_01').decided_at, origQ1);
    assert.equal(decBeforeConfirm.stale_source_decisions.find(d => d.id === 'Q_T01_1_02').decided_at, origQ2);
    assert.equal(decBeforeConfirm.stale_source_decisions.find(d => d.id === 'Q_T01_1_03').decided_at, origQ3);

    // Inspect localStorage directly for Q1 checks & timestamps
    const afterReconcile = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v1')).people['Hải'].states);
    assert.equal(afterReconcile['question:Q_T01_1_01'].decision, 'approve');
    assert.equal(afterReconcile['question:Q_T01_1_01'].decided_at, origQ1);
    assert.equal(afterReconcile['question:Q_T01_1_01'].checks.source_supports, false);
    assert.equal(afterReconcile['question:Q_T01_1_01'].checks.correct_answer, true);
    assert.equal(afterReconcile['question:Q_T01_1_01'].source_recheck_needed, true);

    // Confirm new sources on Q1: keeps original decided_at, records separate source_rechecked_at, moves to .decisions
    await pickQ('Q_T01_1_01');
    await page.locator('#confirm-sources').click();
    assert.equal(await page.locator('#stale-source-banner').count(), 0);
    assert.match(await page.locator('#decision-status').innerText(), /Approved · .* · Sources confirmed/);
    const afterConfirm = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v1')).people['Hải'].states['question:Q_T01_1_01']);
    assert.equal(afterConfirm.decided_at, origQ1);
    assert.ok(afterConfirm.source_rechecked_at);
    assert.equal(afterConfirm.checks.source_supports, true);
    assert.equal(afterConfirm.source_recheck_needed, false);

    // Scenario 8b: Repeated reloads keep confirmed state AND unconfirmed stale states intact
    await page.reload();
    await page.reload();
    await page.locator('#type').selectOption('question');
    await pickQ('Q_T01_1_01');
    assert.match(await page.locator('#decision-status').innerText(), /Sources confirmed/);
    await pickQ('Q_T01_1_02');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Needs changes/);

    // Scenario 9 check after confirm
    dl = page.waitForEvent('download');
    await page.locator('#view-menu summary').click();
    await page.locator('#decisions').click();
    f = await dl;
    const decAfterConfirm = JSON.parse(fs.readFileSync(await f.path(), 'utf8'));
    assert.equal(decAfterConfirm.decisions.length, 1);
    assert.equal(decAfterConfirm.decisions[0].id, 'Q_T01_1_01');
    assert.equal(decAfterConfirm.decisions[0].decided_at, origQ1);
    assert.equal(decAfterConfirm.decisions[0].source_rechecked_at, afterConfirm.source_rechecked_at);
    assert.equal(decAfterConfirm.stale_source_decisions.length, 3);

    // Scenario 7 + 8c: Switch reviewer to Hiếu -> legacy V1 (Q4) and V2 (Q5) states reconcile automatically!
    await page.locator('#reviewer').selectOption('Hiếu');
    await page.locator('#assignment-scope').selectOption('all');
    await page.locator('#type').selectOption('question');
    await pickQ('Q_T01_1_04');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Approved/);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'Legacy V1 approval note');
    await pickQ('Q_T01_1_05');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Needs changes/);
    assert.equal(await page.getByLabel('Flag an issue').isChecked(), true);

    // Scenario 8d: Source-only file load (#files) AFTER confirmation triggers fresh stale check while preserving original decided_at!
    const q1_v4 = v2Q(q1_v2, 'https://example.org/new-1-fileload');
    const jsonl4 = path.join(tmp, 'v4.jsonl');
    fs.writeFileSync(jsonl4, JSON.stringify(q1_v4) + '\n');
    await page.locator('#reviewer').selectOption('Hải');
    await page.locator('#type').selectOption('question');
    await page.locator('#files').setInputFiles(jsonl4);
    await pickQ('Q_T01_1_01');
    assert.match(await page.locator('#stale-source-banner').innerText(), /Retained prior decision: Approved/);
    const afterFileLoad = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v1')).people['Hải'].states['question:Q_T01_1_01']);
    assert.equal(afterFileLoad.decided_at, origQ1);
    assert.equal(afterFileLoad.source_recheck_needed, true);
    assert.equal(afterFileLoad.checks.source_supports, false);

    // Scenario 8e: Export package & import a legacy V1 review package into a brand-new isolated context
    const legacyPkg = {
      format: 'course-review-package', version: 1, reviewer: 'Cường', exported_at: '2026-11-01T10:00:00.000Z',
      position: 'question:Q_T01_1_04',
      items: [{
        item_type: 'question', id: 'Q_T01_1_04',
        state: {
          notes: 'Imported legacy note', sections: {}, flag: false,
          checks: {source_supports: true, correct_answer: true, distractors_explained: true, facts_code_accurate: true},
          decision: 'approve', decided_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z',
          fingerprint: sha(q4)
        }
      }]
    };
    const pkgPath = path.join(tmp, 'legacy-pkg.json');
    fs.writeFileSync(pkgPath, JSON.stringify(legacyPkg));
    const freshCtx = await browser.newContext();
    const fresh = await freshCtx.newPage();
    fresh.on('pageerror', e => errors.push(e.message));
    await fresh.goto(pathToFileURL(path.join(app, 'review-pages', 'dsa.html')).href);
    await fresh.locator('#view-menu summary').click();
    await fresh.locator('#import').setInputFiles(pkgPath);
    await fresh.getByText(/retained prior decisions for source recheck/).waitFor();
    await fresh.locator('#assignment-scope').selectOption('all');
    await fresh.locator('#type').selectOption('question');
    await fresh.locator('.rail-tab').hover({force: true});
    await fresh.locator('#queue button', {hasText: 'Q_T01_1_04'}).click();
    assert.match(await fresh.locator('#stale-source-banner').innerText(), /Retained prior decision: Approved/);
    assert.equal(await fresh.getByLabel('Overall notes / what should be fixed').inputValue(), 'Imported legacy note');

    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log('PASS: all 9 source-preservation scenarios (approve/revise/reject, notes/sections/flags/checks, recheck flagging & filter/progress/next-unfinished, substantive reset, legacy V1/V2 migration, repeated reloads, reviewer switching, #files update, export/import, stale_source_decisions separation); zero pageerrors or network calls.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
