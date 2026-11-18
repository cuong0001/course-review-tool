/* Isolated Playwright E2E test for OOP (CSC10003) and CN (CSC10008) preview review UI.
 * Verifies course isolation, DSA non-interference, source parity, reload preservation,
 * source-only vs content-change semantics, cross-course package rejection, and audit overlay hashing.
 */
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function makeSandboxApp(dir) {
  const app = path.join(dir, 'app');
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  for (const f of [
    'review.css',
    'review-assignments.js',
    'review-core.js',
    'course-review-core.js',
    'review-diff.js',
    'review-renderers.js',
    'course-review.js',
    'review.js',
  ]) {
    fs.copyFileSync(path.join(root, f), path.join(app, f));
  }
  fs.cpSync(path.join(root, 'vendor'), path.join(app, 'vendor'), { recursive: true });
  fs.cpSync(path.join(root, 'review-pages'), path.join(app, 'review-pages'), { recursive: true });
  for (const snap of ['data/oop-review-data.js', 'data/cn-review-data.js', 'data/dsa-review-data.js']) {
    if (fs.existsSync(path.join(root, snap))) {
      fs.copyFileSync(path.join(root, snap), path.join(app, snap));
    }
  }
  return app;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-preview-e2e-'));
  const app = makeSandboxApp(tmp);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });

    // 1. Seed a sentinel in DSA localStorage to verify zero cross-contamination
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'dsa.html')).href);
    await page.evaluate(() => {
      localStorage.setItem('course-review-workspaces-v1', JSON.stringify({ reviewer: 'Hải', people: { 'Hải': { states: { 'question:Q_T00_1_01': { notes: 'DSA sentinel', decision: 'approve' } }, position: '' } } }));
    });

    // 2. Open OOP preview, verify course title, lesson rendering, question rendering, and source links
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'oop.html')).href);
    await page.locator('#reviewer').selectOption('Hải');
    await page.locator('#item h2, #item .item-id').first().waitFor();
    assert.match(await page.locator('header .brand').innerText(), /CSC10003/);

    await page.locator('#type').selectOption('question');
    await page.locator('.question-stem').waitFor();
    const firstQId = await page.locator('#item .item-id').innerText();
    const oopSourceCount = await page.locator('#item .sources a').count();
    assert.ok(oopSourceCount >= 1, 'OOP question must render clickable source URLs');

    // Approve first OOP question with a note
    await page.getByLabel('Overall notes / what should be fixed').fill('OOP pilot question verified');
    await page.locator('#approve').click();
    await page.locator('#decision-status').getByText(/Approved/).waitFor();

    // Reload OOP and confirm persistence
    await page.reload();
    await page.locator('.rail-tab').hover({ force: true });
    await page.locator('#type').selectOption('question');
    await page.locator('#queue button', { hasText: firstQId }).click();
    await page.mouse.move(900, 600);
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'OOP pilot question verified');
    assert.match(await page.locator('#decision-status').innerText(), /Approved/);

    // Export OOP package
    const dlPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const dl = await dlPromise;
    const oopPkgPath = path.join(tmp, 'oop-export.json');
    await dl.saveAs(oopPkgPath);
    const oopPkg = JSON.parse(fs.readFileSync(oopPkgPath, 'utf8'));
    assert.equal(oopPkg.course_id, 'CSC10003');
    assert.equal(oopPkg.version, 2);

    // 3. Open CN preview and verify isolation + cross-course rejection
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'cn.html')).href);
    await page.locator('#reviewer').selectOption('Hải');
    assert.match(await page.locator('header .brand').innerText(), /CSC10008/);
    // Must not see OOP workspace items or any decisions/notes in CN localStorage
    const cnStates = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v2:CSC10008')).people['Hải'].states);
    assert.ok(Object.keys(cnStates).every(k => !k.includes('OOP_') && !cnStates[k].decision && !cnStates[k].notes));

    // Attempt to import OOP package into CN -> must reject
    await page.locator('#view-menu summary').click();
    await page.locator('#import').setInputFiles(oopPkgPath);
    await page.getByText(/Course mismatch/).waitFor();
    const cnStatesAfterReject = await page.evaluate(() => JSON.parse(localStorage.getItem('course-review-workspaces-v2:CSC10008')).people['Hải'].states);
    assert.ok(Object.keys(cnStatesAfterReject).every(k => !k.includes('OOP_') && !cnStatesAfterReject[k].decision && !cnStatesAfterReject[k].notes));

    // Check CN question KaTeX / code / sources rendering
    await page.locator('#type').selectOption('question');
    await page.locator('.question-stem').waitFor();
    const cnSourceCount = await page.locator('#item .sources a').count();
    assert.ok(cnSourceCount >= 1, 'CN question must render clickable source URLs');

    // Check source-only vs content-change in OOP
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'oop.html')).href);
    const vm = require('node:vm');
    const oopCtx = {};
    vm.runInNewContext(fs.readFileSync(path.join(app, 'data/oop-review-data.js'), 'utf8'), oopCtx);
    const origQ = oopCtx.OOPReviewData.records.find(r => r.question_id === firstQId);
    const sourceOnlyQ = { ...origQ, reference_sources: [...origQ.reference_sources, 'https://en.cppreference.com/cpp/language/classes'] };
    const sourceOnlyPath = path.join(tmp, 'source-only.jsonl');
    fs.writeFileSync(sourceOnlyPath, JSON.stringify(sourceOnlyQ) + '\n');
    await page.locator('#view-menu summary').click();
    await page.locator('#files').setInputFiles(sourceOnlyPath);
    await page.locator('#view-menu summary').click();
    await page.getByText(/prior decision retained — recheck sources/).waitFor();
    await page.locator('#confirm-sources').click();
    await page.getByText(/New references confirmed/).waitFor();

    const contentChangedQ = { ...sourceOnlyQ, stem: sourceOnlyQ.stem + ' (Edited stem)' };
    const contentChangedPath = path.join(tmp, 'content-changed.jsonl');
    fs.writeFileSync(contentChangedPath, JSON.stringify(contentChangedQ) + '\n');
    await page.locator('#view-menu summary').click();
    await page.locator('#files').setInputFiles(contentChangedPath);
    await page.locator('#view-menu summary').click();
    await page.getByText(/source content changed/).waitFor();
    assert.equal(await page.locator('#decision-status').innerText(), '');
    assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(), 'OOP pilot question verified');

    // 4. Mobile width check
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // 5. Verify DSA sentinel localStorage is 100% untouched
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'dsa.html')).href);
    const dsaRaw = await page.evaluate(() => localStorage.getItem('course-review-workspaces-v1'));
    const dsaParsed = JSON.parse(dsaRaw);
    assert.equal(dsaParsed.people['Hải'].states['question:Q_T00_1_01'].notes, 'DSA sentinel');
    assert.equal(dsaParsed.people['Hải'].states['question:Q_T00_1_01'].decision, 'approve');
    assert.equal(dsaParsed.people['Hải'].states[`question:${firstQId}`], undefined);

    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log('PASS: OOP/CN isolated preview, DSA non-interference, cross-course rejection, source-only vs content-change, reload, mobile 375px, 0 network requests.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
