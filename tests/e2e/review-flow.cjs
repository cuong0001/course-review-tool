/* Reviewer workflow: minimal layout (hover queue, no before/after panel), LaTeX source, keyboard, search, stable navigation, undo, view options. */
const {chromium} = require('@playwright/test');
const assert = require('node:assert/strict'), path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '../..');
const q = (n, over = {}) => ({question_id: `Q_T05_1_0${n}`, topic_id: 'T05_1', stem: `Question ${n}: loop count?`,
  options: [{option_id: 'A', text: 'once'}, {option_id: 'B', text: 'twice'}], correct_option_id: 'B', answer_explanation: 'Because.',
  distractor_explanations: {A: 'No.'}, human_review_status: 'pending', approved_by: null, approved_at: null, version: '1.0.1',
  reference_sources: [{url: 'https://example.org/source'}], ...over});
const changed = q(1, {stem: String.raw`Question 1: why is it $\Theta(n^2)$?`, answer_explanation: String.raw`Two nested loops give $\Theta(n^2)$.`});
const data = {version: 1, members: ['Cường', 'Hiếu', 'Hải', 'An', 'Khánh'],
  assignments: {question: {Q_T05_1_01: 'Hải', Q_T05_1_02: 'Hải', Q_T05_1_03: 'Hải'}, lesson: {}},
  records: [changed, q(2), q(3, {stem: 'Question 3: unique needle word.'})],
  summary: {approved_questions: 0, pending_questions: 3, revise_questions: 0, lessons: 0},
  changes: {'question:Q_T05_1_01': {compared_with: 'run TEST', status_before: 'approved', approved_by_before: 'An', version_before: '1.0.0',
    fields: [{path: 'stem', label: 'stem', before: 'Question 1: why is it `Theta(n^2)`?', after: changed.stem},
      {path: 'answer_explanation', label: 'answer explanation', before: 'Two nested loops give Theta(n^2).', after: changed.answer_explanation}]}}};

(async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'review-flow-app-')), shots = fs.mkdtempSync(path.join(os.tmpdir(), 'review-flow-shots-'));
  for (const f of ['review.css', 'review-core.js', 'review-diff.js', 'review-renderers.js', 'review-assignments.js', 'review.js']) fs.copyFileSync(path.join(root, f), path.join(app, f));
  fs.cpSync(path.join(root, 'vendor'), path.join(app, 'vendor'), {recursive: true});
  fs.cpSync(path.join(root, 'review-pages'), path.join(app, 'review-pages'), {recursive: true});
  fs.mkdirSync(path.join(app, 'data')); fs.writeFileSync(path.join(app, 'data/dsa-review-data.js'), 'globalThis.DSAReviewData = ' + JSON.stringify(data) + ';');
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 950}}), page = await context.newPage(), errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await page.goto(pathToFileURL(path.join(app, 'review-pages', 'dsa.html')).href);
    await page.locator('#reviewer').selectOption('Hải'); await page.locator('#type').selectOption('question');
    const h2 = () => page.locator('#item h2').first().textContent();
    // The queue is a rail that opens on hover; hover it before clicking an entry.
    const pick = async n => { await page.locator('.rail-tab').hover({force: true}); await page.locator('#queue button').nth(n).click(); };

    // Queue: status chips, count; "Changed since last version" filter. The panel is hidden until hovered.
    assert.equal(await page.locator('#queue button').count(), 3);
    assert.match(await page.locator('#queue button').first().textContent(), /^Q_T05_1_01 · Not started/);
    assert.equal(await page.locator('.rail-panel').evaluate(e => getComputedStyle(e).opacity), '0');
    await page.locator('.rail-tab').hover({force: true}); await page.waitForTimeout(250);
    assert.equal(await page.locator('.rail-panel').evaluate(e => getComputedStyle(e).opacity), '1');
    await page.mouse.move(900, 600);
    assert.match(await page.locator('#queue-count').textContent(), /3 items · 0 finished/);
    await page.locator('#filter').selectOption('changed'); assert.equal(await page.locator('#queue button').count(), 1); await page.locator('#filter').selectOption('all');

    // Only the current version is shown: no before/after panel, and the new text renders its formulas.
    assert.equal(await page.locator('.changes, .change-before, .source-diff').count(), 0);
    assert.ok(await page.locator('.question-stem .katex').count() >= 1 && await page.locator('.explanation .katex').count() >= 1);
    // Inline formulas sit on the text baseline (not shifted as an inline-block).
    assert.equal(await page.locator('.question-stem .learning-math').first().evaluate(e => getComputedStyle(e).display + '/' + getComputedStyle(e).verticalAlign), 'inline/baseline');
    // The content takes most of the width.
    assert.ok(await page.locator('.review-content').evaluate(e => e.getBoundingClientRect().width) > 1000);
    await page.screenshot({path: path.join(shots, 'question-desktop.png'), fullPage: true});

    // LaTeX source: hover title, toggle with T, preference survives reload.
    assert.match(await page.locator('.question-stem .learning-math').first().getAttribute('title'), /LaTeX source: \$\\Theta\(n\^2\)\$/);
    assert.equal(await page.locator('.question-stem .tex-source').first().isVisible(), false);
    await page.keyboard.press('t'); assert.equal(await page.locator('.question-stem .tex-source').first().isVisible(), true);
    await page.screenshot({path: path.join(shots, 'latex-source.png')});
    await page.reload(); await page.locator('#item h2').first().waitFor();
    assert.equal(await page.locator('.question-stem .tex-source').first().isVisible(), true);
    await page.keyboard.press('t');

    // Keyboard: Alt+→ / Alt+←, J/K; letters typed into notes stay in notes; F flags; N focuses notes; U next unfinished.
    await page.keyboard.press('Alt+ArrowRight'); assert.equal(await h2(), 'Q_T05_1_02');
    await page.keyboard.press('k'); assert.equal(await h2(), 'Q_T05_1_01');
    await page.keyboard.press('j'); assert.equal(await h2(), 'Q_T05_1_02');
    await page.keyboard.press('n'); assert.equal(await page.evaluate(() => document.activeElement.id), 'overall-notes');
    await page.keyboard.type('jkfu notes'); assert.equal(await h2(), 'Q_T05_1_02');
    assert.equal(await page.locator('#overall-notes').inputValue(), 'jkfu notes'); assert.equal(await page.locator('#flag').isChecked(), false);
    await page.locator('#overall-notes').press('Alt+ArrowLeft'); assert.equal(await h2(), 'Q_T05_1_01');
    await page.locator('.review-content').click({position: {x: 600, y: 5}}); await page.keyboard.press('f');
    assert.equal(await page.locator('#flag').isChecked(), true); assert.match(await page.locator('#queue button[aria-current=true] .chip').textContent(), /Flagged/);
    await page.keyboard.press('f'); assert.equal(await page.locator('#flag').isChecked(), false);
    assert.equal(await page.locator('#decision-help').textContent(), '');
    assert.equal(await page.locator('#approve').isDisabled(), false); assert.equal(await page.locator('#revise').isDisabled(), true);

    // Search: ID, content and the reviewer's own notes; Enter opens the first match; Esc clears.
    await page.keyboard.press('/'); assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    await page.keyboard.type('needle'); await page.waitForTimeout(250); assert.equal(await page.locator('#queue button').count(), 1);
    assert.match(await page.locator('#queue-count').textContent(), /1 matching item/);
    await page.keyboard.press('Enter'); assert.equal(await h2(), 'Q_T05_1_03');
    await page.locator('#search').fill('jkfu'); await page.waitForTimeout(250); assert.equal(await page.locator('#queue button').count(), 1);
    await page.locator('#search').press('Escape'); assert.equal(await page.locator('#search').inputValue(), ''); assert.equal(await page.locator('#queue button').count(), 3);
    await page.locator('#search').fill('zzz-no-match'); await page.waitForTimeout(250);
    await page.getByText('No items in this view.', {exact: false}).waitFor();
    await page.locator('#search').blur(); await page.mouse.move(900, 600); await page.getByRole('button', {name: 'Clear search and filters'}).click();
    assert.equal(await page.locator('#queue button').count(), 3);

    // Stable navigation: finishing an item while showing "In progress" moves to the item after it, not the top.
    await pick(2); await page.locator('#overall-notes').fill('third note');
    await page.locator('#filter').selectOption('in-progress'); assert.equal(await page.locator('#queue button').count(), 3);
    await pick(1); assert.equal(await h2(), 'Q_T05_1_02');
    await page.mouse.move(900, 600); await page.getByRole('button', {name: 'Needs changes', exact: true}).click();
    assert.equal(await page.locator('#queue button').count(), 2, 'finished item leaves the in-progress view');
    assert.equal(await h2(), 'Q_T05_1_03', 'moved to the item that followed, not back to the top');
    await page.locator('#filter').selectOption('all'); await pick(1); await page.mouse.move(900, 600);
    assert.match(await page.locator('#decision-status').textContent(), /^Needs changes · /);

    // Undo restores the state before the decision (notes kept); any edit after a decision withdraws Undo.
    assert.equal(await page.locator('#undo').isVisible(), true); await page.locator('#undo').click();
    assert.equal(await page.locator('#decision-status').textContent(), ''); assert.equal(await page.locator('#overall-notes').inputValue(), 'jkfu notes');
    await page.getByRole('button', {name: 'Needs changes', exact: true}).click(); assert.equal(await page.locator('#undo').isVisible(), true);
    await page.locator('#overall-notes').fill('jkfu notes, more'); assert.equal(await page.locator('#undo').isVisible(), false);
    assert.equal(await page.locator('#decision-status').textContent(), '');

    // Approve needs no checklist: it records every check as confirmed. "Next unfinished" skips finished items.
    await page.getByRole('button', {name: 'Approve', exact: true}).click();
    assert.match(await page.locator('#decision-status').textContent(), /^Approved · /);
    assert.match(await page.locator('#approve').getAttribute('title'), /Approving confirms:[\s\S]*The correct answer is correct/);
    await pick(0); await page.mouse.move(900, 600); await page.keyboard.press('u'); assert.equal(await h2(), 'Q_T05_1_03');

    // Shortcut dialog, focus mode, text size; all persist as display preferences only.
    await page.keyboard.press('?'); assert.equal(await page.locator('#shortcuts').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#shortcuts').isVisible(), false);
    await page.locator('#view-menu summary').click(); await page.locator('#text-larger').click();
    assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '105%');
    await page.locator('#focus-mode').check(); assert.equal(await page.locator('.sidebar').isVisible(), false);
    await page.reload(); await page.locator('#item h2').first().waitFor();
    assert.equal(await page.locator('.sidebar').isVisible(), false); assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '105%');
    await page.screenshot({path: path.join(shots, 'focus-mode.png')});
    await page.locator('#view-menu summary').click(); await page.locator('#focus-mode').uncheck(); await page.locator('#text-smaller').click();
    assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '');

    // Dark theme and phone width: no horizontal scroll.
    await page.locator('#theme').click(); await pick(0); await page.mouse.move(900, 600);
    await page.screenshot({path: path.join(shots, 'question-dark.png'), fullPage: true});
    await page.setViewportSize({width: 375, height: 812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: path.join(shots, 'question-mobile.png'), fullPage: true});
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    console.log('PASS: minimal layout (hover queue, wide content, no before/after panel, baseline math), one-click approve, LaTeX source toggle, keyboard shortcuts (safe while typing), search incl. notes, stable navigation after a decision, undo and its withdrawal, next not finished, dialog, focus mode, text size, dark, 375px; no network requests.');
    console.log('Screenshots: ' + shots);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
