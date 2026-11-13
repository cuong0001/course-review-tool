/* UI reads only the bundled snapshot and files the reviewer selects. No dataset writes or network fetches. */
'use strict';
const C = ReviewCore, $ = id => document.getElementById(id);
const storeKey = 'course-review-workspaces-v1', prefsKey = 'course-review-prefs-v1';
let db = {reviewer: '', people: {}}, loaded = {}, active = '', session = new Set(), storageBroken = false;
let lastRows = [], undo = null, prefs = {scale: 1, showTex: false, focus: false};
const STATUS_LABEL = {unreviewed: 'Not started', 'in-progress': 'In progress', flagged: 'Flagged', finished: 'Finished'};
const DECISION_LABEL = {approve: 'Verified', revise: 'Needs fixes', reject: 'Rejected'};

function message(text) { $('message').textContent = text; if (!text) $('undo').hidden = true; }
try {
  const raw = localStorage.getItem(storeKey);
  if (raw) { const parsed = JSON.parse(raw); if (!parsed.people || typeof parsed.people !== 'object') throw Error('Invalid local save'); db = parsed; }
} catch (e) { storageBroken = true; message('Could not restore local storage. Import your latest exported package.'); }

function workspace() { return db.people[db.reviewer]; }
function save() {
  try {
    // Keep other reviewers' latest saves when workspaces are open in separate tabs.
    if (workspace()) workspace().scope = $('assignment-scope').value;
    const remote = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (remote?.people && db.reviewer) db.people = {...remote.people, [db.reviewer]: workspace()};
    localStorage.setItem(storeKey, JSON.stringify(db)); storageBroken = false;
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    $('saved').textContent = `Saved locally at ${time} — export a backup before leaving`; $('saved').className = 'save-ok';
  } catch (e) { storageBroken = true; $('saved').textContent = 'Not saved—export a backup'; $('saved').className = 'save-error'; }
}
function nameRequired() { if (!db.reviewer) { message('Choose your name to open your assigned DSA workspace.'); return false; } return true; }
function state(k) { const w = workspace(); return w.states[k] || (w.states[k] = C.blank()); }
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function button(text, fn, cls) { const b = node('button', text, cls); b.type = 'button'; b.onclick = fn; return b; }
function link(parent, url) { try { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol)) return false; const a = node('a', url); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a, node('br')); return true; } catch { return false; } }
function urls(value) { const found = []; (function walk(v) { if (typeof v === 'string') found.push(...(v.match(/https?:\/\/[^\s<>"\\]+/g) || [])); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(value); return [...new Set(found)]; }
async function fingerprint(record) { const bytes = new TextEncoder().encode(JSON.stringify(record)); const hash = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''); }

// ------------------------------------------------------------------ preferences (display only, never content)
function savePrefs() { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* display preference only */ } }
function applyPrefs() {
  prefs.scale = Math.min(1.4, Math.max(0.85, Math.round(prefs.scale * 20) / 20));
  document.documentElement.style.fontSize = prefs.scale === 1 ? '' : `${prefs.scale * 100}%`;
  document.documentElement.classList.toggle('show-tex', prefs.showTex);
  document.documentElement.classList.toggle('focus-mode', prefs.focus);
  $('text-size').value = `${Math.round(prefs.scale * 100)}%`;
  $('show-tex').checked = prefs.showTex; $('focus-mode').checked = prefs.focus;
}
try { prefs = {...prefs, ...JSON.parse(localStorage.getItem(prefsKey) || '{}')}; } catch { /* defaults */ }
applyPrefs();

// ------------------------------------------------------------------ data loading
async function loadFiles(files) {
  if (!nameRequired()) return;
  try {
    const pending = {};
    for (const file of files) {
      const text = await file.text(); let number = 0;
      for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        number++; if (!line.trim()) continue; let record;
        try { record = JSON.parse(line); } catch { throw Error(`${file.name}, line ${number}: invalid JSON`); }
        const kinds = Object.keys(C.ids).filter(k => typeof record[C.ids[k]] === 'string');
        if (kinds.length !== 1) throw Error(`${file.name}, line ${number}: unsupported record`);
        const kind = kinds[0], id = record[C.ids[kind]], k = C.key(kind, id);
        if (pending[k]) throw Error(`Duplicate ID ${id}`);
        pending[k] = {kind, id, record, fingerprint: await fingerprint(record)};
      }
    }
    let changed = 0;
    for (const [k, item] of Object.entries(pending)) {
      const before = loaded[k];
      if (before && before.fingerprint !== item.fingerprint) {
        // Without review-diff.js (an incomplete copy of the folder) files still load; only the comparison is skipped.
        if (globalThis.ReviewDiff) { item.changes = {compared_with: before.bundled ? 'the bundled snapshot' : 'the previously loaded file', fields: ReviewDiff.diffRecords(before.record, item.record)}; changed++; }
      } else if (before?.changes) item.changes = before.changes;
      loaded[k] = item;
      const s = workspace().states[k];
      if (s && s.fingerprint !== item.fingerprint) { C.edit(s, 'checks', {}); s.fingerprint = item.fingerprint; session.delete(k); message(`${item.id}: source content changed; notes retained, verification reset.`); }
    }
    if (changed && !$('message').textContent) message(`${changed} loaded records differ from what was shown before; open one to see what changed.`);
    save(); render();
  } catch (e) { message(`Import failed: ${e.message}`); } finally { $('files').value = ''; }
}

// ------------------------------------------------------------------ queue
function status(s) { return s.decision ? 'finished' : s.flag ? 'flagged' : s.updated_at ? 'in-progress' : 'unreviewed'; }
function changesFor(k) { const item = loaded[k]; return item?.changes || (item?.bundled ? DSAReviewData.changes?.[k] : null) || null; }
function eligible() {
  return Object.entries(loaded)
    .filter(([, i]) => $('assignment-scope').value === 'all' || ReviewAssignments.belongs(DSAReviewData, i, db.reviewer))
    .filter(([, i]) => !['resource', 'activity'].includes(i.kind) || $('extras').checked)
    .filter(([, i]) => i.kind !== 'question' || ['pending', 'revise'].includes(i.record.human_review_status));
}
const fold = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const recordText = new WeakMap();
function searchable(k, item) {
  if (!recordText.has(item.record)) {
    const r = item.record, parts = [item.id, r.title, r.stem, r.answer_explanation, r.lecture_title, ...(r.options || []).map(o => o.text), ...Object.values(r.distractor_explanations || {})];
    for (const b of r.blocks || []) parts.push(b.title, b.body_md, b.prompt, b.reveal_md, b.description, b.caption);
    recordText.set(item.record, fold(parts.filter(Boolean).join('\n')));
  }
  const s = workspace().states[k];
  return recordText.get(item.record) + (s ? '\n' + fold([s.notes, ...Object.values(s.sections)].join('\n')) : '');
}
function items() {
  const topic = $('topic').value, filter = $('filter').value, query = fold($('search').value).trim();
  return eligible().filter(([k, i]) => i.kind === $('type').value
      && (!topic || [i.record.topic_id, ...(i.record.topic_ids || [])].includes(topic))
      && (filter === 'all' || (filter === 'flagged' ? state(k).flag : filter === 'changed' ? !!changesFor(k) : status(state(k)) === filter))
      && (!query || query.split(/\s+/).every(word => searchable(k, i).includes(word))))
    .sort((a, b) => { const rank = i => i.record.human_review_status === 'revise' ? 1 : 0; return rank(a[1]) - rank(b[1]) || (a[1].record.topic_id || '').localeCompare(b[1].record.topic_id || '') || a[1].id.localeCompare(b[1].id); });
}
function chip(k) {
  const s = state(k), st = status(s);
  const text = s.decision ? DECISION_LABEL[s.decision] : STATUS_LABEL[st];
  return node('span', text, `chip chip-${s.decision || st}`);
}
function progress() {
  const target = $('progress'); target.replaceChildren();
  target.append(node('h3', db.reviewer + ($('assignment-scope').value === 'mine' ? ' — your assigned work' : ' — viewing all team assignments')));
  const all = eligible();
  for (const kind of ['overall', ...Object.keys(C.ids).filter(kind => all.some(([, item]) => item.kind === kind))]) {
    const rows = all.filter(([, i]) => kind === 'overall' || i.kind === kind), done = rows.filter(([k]) => state(k).decision).length;
    const row = node('div', `${kind}: ${done} / ${rows.length} finished`, 'progress-row'), bar = node('progress');
    bar.max = rows.length || 1; bar.value = done; bar.setAttribute('aria-label', `${kind} completion`); row.append(bar); target.append(row);
  }
  target.append(node('p', `${session.size} items finalized this session`));
}
function drawQueue(rows) {
  const queue = $('queue'); queue.replaceChildren();
  const filtered = $('search').value.trim() || $('filter').value !== 'all' || $('topic').value;
  const finished = rows.filter(([k]) => state(k).decision).length;
  $('queue-count').textContent = rows.length ? `${rows.length} ${filtered ? 'matching ' : ''}item${rows.length === 1 ? '' : 's'} · ${finished} finished` : '';
  let current = null;
  for (const [k, i] of rows) {
    const b = button('', () => open(k), 'queue-item');
    b.append(document.createTextNode(`${i.id} · `), chip(k));
    if (state(k).flag) b.append(node('span', ' ⚑ flagged', 'queue-flag'));
    if (changesFor(k)) b.append(node('span', ' changed', 'queue-changed'));
    const preview = node('span', undefined, 'queue-preview'); ReviewRender.inline(preview, i.record.title || i.record.stem || i.record.lecture_title || ''); b.append(preview);
    b.setAttribute('aria-current', String(k === active)); if (k === active) current = b;
    queue.append(b);
  }
  // Keep the selected entry visible inside the queue without scrolling the page.
  if (current) { const top = current.offsetTop - queue.offsetTop; if (top < queue.scrollTop || top + current.offsetHeight > queue.scrollTop + queue.clientHeight) queue.scrollTop = Math.max(0, top - queue.clientHeight / 3); }
}
function render() {
  if (!db.reviewer) return;
  progress();
  const rows = items(), keys = rows.map(([k]) => k);
  if (!keys.includes(active)) {
    // The current item left this view (for example it was just finished while showing "Not started"):
    // move to the item that followed it, never back to the top of the list.
    const old = lastRows.indexOf(active);
    active = (old >= 0 && lastRows.slice(old + 1).find(k => keys.includes(k))) || (old >= 0 && [...lastRows.slice(0, old)].reverse().find(k => keys.includes(k))) || keys[0] || '';
  }
  lastRows = keys; drawQueue(rows);
  if (active) { workspace().position = active; drawItem(rows); save(); }
  else {
    const empty = node('section', undefined, 'empty-state');
    empty.append(node('p', 'No items in this view. Load a file or change the filters.'));
    if ($('search').value || $('filter').value !== 'all' || $('topic').value) empty.append(button('Clear search and filters', clearFilters));
    $('item').className = ''; $('item').replaceChildren(empty);
  }
}
function open(k, {focus = false} = {}) {
  active = k; workspace().position = k; save(); render();
  $('item').scrollIntoView({block: 'start'});
  if (focus) $('item').focus({preventScroll: true});
  $('live').textContent = `${loaded[k].id}, ${lastRows.indexOf(k) + 1} of ${lastRows.length}`;
}
function step(delta) { const i = lastRows.indexOf(active), k = lastRows[i + delta]; if (k) open(k); }
function nextOpenKey() {
  const i = lastRows.indexOf(active);
  return [...lastRows.slice(i + 1), ...lastRows.slice(0, Math.max(i, 0))].find(k => !state(k).decision) || null;
}
function nextOpen() { const k = nextOpenKey(); if (k) open(k); else message('Everything in this queue is finished.'); }
function clearFilters() { $('search').value = ''; $('filter').value = 'all'; $('topic').value = ''; render(); }

// ------------------------------------------------------------------ the current item
function autosize(t) { t.style.height = 'auto'; t.style.height = `${Math.max(t.scrollHeight + 2, 90)}px`; }
function note(parent, label, value, onchange, id) {
  const l = node('label', label), t = node('textarea'); t.value = value; if (id) t.id = id;
  t.addEventListener('input', () => { onchange(t.value); autosize(t); }); l.append(t); parent.append(l);
  requestAnimationFrame(() => autosize(t)); return t;
}
function edited(k, field, value) {
  const s = state(k); C.edit(s, field, value); s.fingerprint = loaded[k].fingerprint; session.delete(k);
  // Undo restores a whole saved state, so it must never be offered after newer edits to the same item.
  if (undo?.key === k) { undo = null; $('undo').hidden = true; }
  save(); progress(); updateActions();
  $('decision-status').textContent = 'In progress';
  const entry = [...$('queue').children].find(b => b.getAttribute('aria-current') === 'true');
  if (entry) entry.querySelector('.chip').replaceWith(chip(k));
}
function detail(parent, value, label = 'Details') {
  if (value === undefined || value === null) return;
  if (typeof value === 'object') { if (Array.isArray(value)) { for (const [index, v] of value.entries()) detail(parent, v, `${label} ${index + 1}`); } else { for (const [k, v] of Object.entries(value)) detail(parent, v, k.replaceAll('_', ' ')); } }
  else parent.append(node('strong', label), rich(String(value)));
}
function drawBlock(parent, block) {
  const section = ReviewRender.block(parent, block);
  note(section, 'Notes for section ' + block.id, state(active).sections[block.id] || '', value => edited(active, 'sections', {...state(active).sections, [block.id]: value}));
}
function rich(text, className = '') { const element = node('div', undefined, className); ReviewRender.prose(element, text); return element; }
function sourceDiff(before, after) {
  const line = node('div', undefined, 'source-diff');
  if (!globalThis.ReviewDiff) { line.textContent = 'review-diff.js is missing from this folder.'; return line; }
  for (const part of ReviewDiff.words(before, after)) line.append(part.op === 'same' ? document.createTextNode(part.text) : node(part.op === 'del' ? 'del' : 'ins', part.text));
  return line;
}
function drawChanges(content, changes) {
  const box = node('details', undefined, 'changes'); box.open = true;
  const was = changes.status_before === 'approved' ? ` · was approved${changes.approved_by_before ? ' by ' + changes.approved_by_before : ''}` : '';
  box.append(node('summary', `What changed · ${changes.fields.length} field${changes.fields.length === 1 ? '' : 's'} · compared with ${changes.compared_with}${was}`));
  box.append(node('p', 'Check that each change says the same thing as before, or that the fix is right. The full item is shown below.', 'sidebar-help'));
  for (const f of changes.fields) {
    const row = node('section', undefined, 'change-field'); row.append(node('h4', f.label));
    const pair = node('div', undefined, 'change-pair');
    const before = node('div', undefined, 'change-before'), after = node('div', undefined, 'change-after');
    before.append(node('span', 'Before', 'change-tag')); after.append(node('span', 'After', 'change-tag'));
    before.append(f.before === null ? node('p', '(not present)', 'sidebar-help') : rich(String(f.before)));
    after.append(f.after === null ? node('p', '(removed)', 'sidebar-help') : rich(String(f.after)));
    pair.append(before, after); row.append(pair);
    const raw = node('details', undefined, 'change-source'); raw.append(node('summary', 'Exact text changes'), sourceDiff(f.before, f.after)); row.append(raw);
    box.append(row);
  }
  content.append(box);
}
function drawItem(rows) {
  const {kind, id, record: r} = loaded[active], s = state(active); s.fingerprint = loaded[active].fingerprint;
  const panel = $('item'), content = node('section', undefined, 'review-content'), review = node('aside', undefined, 'review-panel');
  panel.className = 'item-layout'; panel.replaceChildren(content, review); review.setAttribute('aria-label', 'Notes and verification');
  const index = rows.findIndex(([k]) => k === active), nav = node('div', undefined, 'content-navigation');
  const prev = button('Previous', () => step(-1)), next = button('Next', () => step(1));
  prev.disabled = index <= 0; next.disabled = index >= rows.length - 1; prev.title = 'Alt + ←'; next.title = 'Alt + →';
  const openKey = nextOpenKey(), nextUnfinished = button('Next not finished', nextOpen, 'next-open'); nextUnfinished.disabled = !openKey; nextUnfinished.title = 'U';
  const where = node('span', `${index + 1} of ${rows.length}${rows.length !== eligible().filter(([, i]) => i.kind === kind).length ? ' (filtered)' : ''}`, 'position');
  nav.append(prev, where, nextUnfinished, next); content.append(nav);
  const kicker = node('p', `${kind === 'lesson' ? 'Reading guide' : kind === 'question' ? 'Question' : kind} · ${r.topic_id || (r.topic_ids || []).join(', ')}`, 'content-kicker');
  kicker.append(' ', chip(active)); content.append(kicker);
  const title = node('h2', r.title || r.lecture_title || r.title_en || id), copy = button('Copy ID', () => copyText(id), 'copy-id'); copy.setAttribute('aria-label', `Copy ID ${id}`);
  const head = node('div', undefined, 'item-title'); head.append(title, copy); content.append(head);
  if (kind === 'lesson') content.append(node('p', 'REQUIRED: shown to learners now', 'warning'));
  const changes = changesFor(active); if (changes) drawChanges(content, changes);
  if (kind === 'question') {
    content.append(rich(r.stem, 'question-stem')); const options = node('div', undefined, 'answer-options');
    for (const option of r.options || []) {
      const correct = option.option_id === r.correct_option_id, card = node('section', undefined, correct ? 'correct' : 'option'), heading = node('div', undefined, 'option-heading'), body = node('div', undefined, 'option-copy');
      if (correct) body.append(node('strong', 'Correct answer', 'correct-badge'));
      body.append(rich(option.text)); heading.append(node('span', option.option_id, 'option-letter'), body); card.append(heading);
      if (!correct) { const reason = node('div', undefined, 'distractor-note'); reason.append(node('strong', 'Why this distractor is wrong'), rich(r.distractor_explanations?.[option.option_id] || 'Missing distractor explanation')); card.append(reason); }
      options.append(card);
    }
    content.append(options); const explanation = node('section', undefined, 'explanation'); explanation.append(node('h3', 'Answer explanation'), rich(r.answer_explanation)); content.append(explanation, node('p', `Verification method: ${r.verification_method || 'Not provided'}`, 'verification-method'));
  } else if (kind === 'lesson') { for (const block of r.blocks || []) drawBlock(content, block); }
  else for (const [field, value] of Object.entries(r)) if (!['approved_by', 'approved_at', 'reviewer_comment', 'human_review_status', 'review_status'].includes(field)) {
    if (/code|solution_cpp/.test(field) && typeof value === 'string') { content.append(node('h3', field.replaceAll('_', ' '))); ReviewRender.code(content, value); }
    else detail(content, value, field.replaceAll('_', ' '));
  }
  const refs = node('section', undefined, 'sources'); refs.append(node('h3', 'Sources and references')); const sourceUrls = urls(r); sourceUrls.forEach(url => link(refs, url));
  if (kind === 'video' && r.video_id) link(refs, `https://www.youtube.com/watch?v=${encodeURIComponent(r.video_id)}&t=${r.start_seconds || 0}s`);
  if (!sourceUrls.length || (r.source_ids || []).some(value => value.startsWith('editorial_source_'))) refs.append(node('p', `NO REAL SOURCE${r.source_ids?.length ? ': ' + r.source_ids.join(', ') : ''}`, 'warning'));
  if (['video', 'resource'].includes(kind)) refs.append(node('p', `License: ${r.license_name || r.license?.name || 'MISSING — verify permitted use'}`, r.license_name || r.license?.name ? '' : 'warning'));
  content.append(refs);

  review.append(node('h3', 'Your review'), node('p', 'Notes save automatically in this browser. Export a package before you finish.', 'sidebar-help'));
  const flagLabel = node('label', 'Flag an issue '), flag = node('input'); flagLabel.className = 'check-label flag-label'; flag.type = 'checkbox'; flag.id = 'flag'; flag.checked = s.flag; flag.onchange = () => edited(active, 'flag', flag.checked); flagLabel.prepend(flag); flagLabel.append(node('kbd', 'F')); review.append(flagLabel);
  note(review, 'Overall notes / what should be fixed', s.notes, value => edited(active, 'notes', value), 'overall-notes');
  const checks = node('fieldset', undefined, 'checks'); checks.append(node('legend', 'Verification checks'));
  for (const [key, label] of Object.entries(C.checks[kind])) { const l = node('label', label + ' '), input = node('input'); input.type = 'checkbox'; input.checked = s.checks[key] === true; input.onchange = () => edited(active, 'checks', {...state(active).checks, [key]: input.checked}); l.prepend(input); checks.append(l); }
  review.append(checks);
  const current = node('p', s.decision ? `Final decision: ${DECISION_LABEL[s.decision]} by ${db.reviewer} at ${new Date(s.decided_at).toLocaleString()}` : 'In progress', 'status'); current.id = 'decision-status'; current.setAttribute('aria-live', 'polite'); review.append(current);
  const actions = node('div', undefined, 'toolbar');
  for (const [choice, label] of [['approve', 'Verified'], ['revise', 'Needs fixes'], ['reject', 'Reject']]) {
    const action = button(label, () => decide(kind, choice)); action.id = choice; if (choice === 'approve') action.className = 'primary'; actions.append(action);
  }
  const help = node('p', '', 'decision-help'); help.id = 'decision-help'; help.setAttribute('aria-live', 'polite');
  review.append(actions, help);
  review.append(button('Next not finished →', nextOpen, 'next-open next-open-panel'));
  updateActions();
}
function decide(kind, choice) {
  const before = structuredClone(state(active));
  try {
    C.finalize(state(active), kind, choice); session.add(active);
    undo = {key: active, state: before, reviewer: db.reviewer};
    save(); render();
    message(`Decision saved: ${DECISION_LABEL[choice]}. Export your review package when finished.`); $('undo').hidden = false;
  } catch (error) { message(error.message); }
}
function updateActions() {
  if (!active || !$('approve')) return;
  const s = state(active), kind = loaded[active].kind, missing = Object.keys(C.checks[kind]).filter(k => s.checks[k] !== true).length, hasNote = !!C.comment(s).trim();
  $('approve').disabled = s.flag || missing > 0; $('revise').disabled = $('reject').disabled = !hasNote;
  const help = [];
  if (s.flag) help.push('Clear the flag to verify.'); else if (missing) help.push(`Tick ${missing} more check${missing === 1 ? '' : 's'} to verify.`);
  if (!hasNote) help.push('Write a note to choose Needs fixes or Reject.');
  $('decision-help').textContent = help.join(' ');
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); message(`Copied ${text}.`); } catch { message(`Copy is blocked here; the ID is ${text}.`); } }
function download(value, filename) { try { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json;charset=utf-8'})); const a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); message(`Export requested: ${filename}. Check your downloads and send the file to the owner.`); } catch (e) { message(`Export failed: ${e.message}. Keep this window open.`); } }

// ------------------------------------------------------------------ workspace switching and bundled data
function selectReviewer(name) {
  if (name && !Array.from($('reviewer').options).some(option => option.value === name)) $('reviewer').append(new Option(name + ' (saved/imported)', name));
  $('reviewer').value = name;
}
function reconcileWorkspace() {
  if (!workspace()) return;
  for (const [key, s] of Object.entries(workspace().states)) if (loaded[key] && s.fingerprint && s.fingerprint !== loaded[key].fingerprint) {
    C.edit(s, 'checks', {}); s.fingerprint = loaded[key].fingerprint; session.delete(key);
    message('Source content changed; notes retained, verification reset.');
  }
}
async function loadBundled() {
  try {
    for (const record of DSAReviewData.records) { const kind = record.question_id ? 'question' : 'lesson', id = record[C.ids[kind]]; loaded[C.key(kind, id)] = {kind, id, record, fingerprint: await fingerprint(record), bundled: true}; }
    const summary = DSAReviewData.summary, changed = Object.keys(DSAReviewData.changes || {}).length;
    $('dataset-summary').textContent = `Bundled DSA snapshot: ${summary.approved_questions} approved questions excluded; ${summary.pending_questions} pending + ${summary.revise_questions} needing revision; ${summary.lessons} reading guides requiring real review.` + (changed ? ` ${changed} items changed since the previous version; choose Show → Changed since last version.` : '');
    const table = node('table'), head = node('tr'); for (const title of ['Member', 'Questions', 'Reading guides']) head.append(node('th', title)); table.append(head);
    for (const member of DSAReviewData.members) { const count = ReviewAssignments.counts(DSAReviewData, member), row = node('tr'); for (const value of [member, count.question, count.lesson]) row.append(node('td', String(value))); table.append(row); }
    $('team-summary').append(table);
    reconcileWorkspace(); if (db.reviewer) { active = workspace().position; $('type').value = loaded[active]?.kind || 'lesson'; render(); }
  } catch (error) { message('Could not load bundled DSA content: ' + error.message); }
}
const bundledReady = loadBundled();
$('reviewer').onchange = async () => { await $('switch').onclick(); if (matchMedia('(max-width:760px)').matches) $('item').scrollIntoView({block: 'start'}); };
$('switch').onclick = async () => {
  await bundledReady; const name = $('reviewer').value.trim(); if (!name) { message('Choose your name.'); return; }
  db.reviewer = name; if (!Object.hasOwn(db.people, name)) Object.defineProperty(db.people, name, {value: {states: {}, position: ''}, enumerable: true, writable: true, configurable: true});
  $('assignment-scope').value = 'mine'; reconcileWorkspace(); active = workspace().position; $('topic').value = ''; $('filter').value = 'all'; $('search').value = ''; $('type').value = loaded[active]?.kind || 'lesson';
  session = new Set(); undo = null; $('undo').hidden = true; lastRows = []; save(); render();
};
$('files').onchange = e => loadFiles(e.target.files); $('drop').ondragover = e => e.preventDefault(); $('drop').ondrop = e => { e.preventDefault(); loadFiles(e.dataTransfer.files); };
$('export').onclick = () => { if (!nameRequired()) return; download({format: 'course-review-package', version: 1, reviewer: db.reviewer, exported_at: new Date().toISOString(), position: workspace().position, items: Object.entries(workspace().states).filter(([, s]) => s.fingerprint).map(([k, s]) => ({item_type: k.split(':')[0], id: k.slice(k.indexOf(':') + 1), state: s}))}, `review-${db.reviewer.replace(/[^\p{L}\p{N}_-]/gu, '_')}.json`); };
$('decisions').onclick = () => { if (!nameRequired()) return; download(C.decisions(db.reviewer, workspace().states, Object.fromEntries(eligible())), 'decisions.json'); };
$('import').onchange = async e => {
  try {
    await bundledReady; const p = C.validatePackage(JSON.parse(await e.target.files[0].text())); const existing = db.people[p.reviewer]?.states || {};
    const conflicts = p.items.filter(i => existing[C.key(i.item_type, i.id)] && JSON.stringify(existing[C.key(i.item_type, i.id)]) !== JSON.stringify(i.state));
    if (conflicts.length) throw Error(`Conflicting saved reviews: ${conflicts.map(i => i.id).join(', ')}. Export the local workspace first; use another browser profile to inspect this package separately.`);
    db.reviewer = p.reviewer; if (!Object.hasOwn(db.people, p.reviewer)) Object.defineProperty(db.people, p.reviewer, {value: {states: {}, position: p.position || ''}, enumerable: true, writable: true, configurable: true});
    for (const i of p.items) { const k = C.key(i.item_type, i.id), s = structuredClone(i.state); if (loaded[k] && s.fingerprint !== loaded[k].fingerprint) { C.edit(s, 'checks', {}); s.fingerprint = loaded[k].fingerprint; } workspace().states[k] = s; }
    selectReviewer(p.reviewer); active = workspace().position; session = new Set(); undo = null; save(); render();
    message('Package restored. Assigned DSA content is ready; load matching files only for additional content.');
  } catch (err) { message(`Import failed: ${err.message}`); } finally { e.target.value = ''; }
};
for (const id of ['type', 'topic', 'filter', 'extras', 'assignment-scope']) $(id).onchange = () => render();
let searchTimer = 0;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
$('search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); if ($('search').value) { $('search').value = ''; render(); } else $('search').blur(); } if (e.key === 'Enter' && lastRows[0]) { e.preventDefault(); open(lastRows[0], {focus: true}); } });
$('clear-filters').onclick = () => { if (nameRequired()) clearFilters(); };
$('continue').onclick = () => { if (!nameRequired()) return; const k = workspace().position; if (loaded[k]) { $('type').value = loaded[k].kind; $('filter').value = 'all'; $('topic').value = ''; $('search').value = ''; open(k); } else render(); };
$('undo').onclick = () => {
  if (!undo || undo.reviewer !== db.reviewer) { $('undo').hidden = true; return; }
  workspace().states[undo.key] = undo.state; session.delete(undo.key); active = undo.key; undo = null;
  save(); render(); message('Decision undone. The item is back to how it was.'); $('undo').hidden = true;
};
// Refresh topic choices after file loads without changing the selected topic.
const originalRender = render;
render = function () { const previous = $('topic').value; const topics = [...new Set(eligible().flatMap(([, i]) => [i.record.topic_id, ...(i.record.topic_ids || [])]).filter(Boolean))].sort(); $('topic').replaceChildren(new Option('All topics', ''), ...topics.map(t => new Option(t, t))); $('topic').value = topics.includes(previous) ? previous : ''; originalRender(); };
selectReviewer(db.reviewer || ''); $('assignment-scope').value = workspace()?.scope || 'mine';
if (db.reviewer) { active = workspace()?.position || ''; if (storageBroken) $('saved').textContent = 'Not saved—export a backup'; else $('saved').textContent = 'Local workspace restored — loading assigned DSA content'; render(); }

// ------------------------------------------------------------------ view options, shortcuts, theme
$('text-smaller').onclick = () => { prefs.scale -= 0.05; applyPrefs(); savePrefs(); };
$('text-larger').onclick = () => { prefs.scale += 0.05; applyPrefs(); savePrefs(); };
$('show-tex').onchange = () => { prefs.showTex = $('show-tex').checked; applyPrefs(); savePrefs(); };
$('focus-mode').onchange = () => { prefs.focus = $('focus-mode').checked; applyPrefs(); savePrefs(); };
$('shortcuts-open').onclick = () => $('shortcuts').showModal();
// The View menu behaves like a menu: a click elsewhere or Escape closes it.
document.addEventListener('click', e => { if ($('view-menu').open && !$('view-menu').contains(e.target)) $('view-menu').open = false; });
$('view-menu').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('view-menu').open = false; $('view-menu').querySelector('summary').focus(); } });
function toggleFlag() { const f = $('flag'); if (!f) return; f.checked = !f.checked; f.dispatchEvent(new Event('change')); message(f.checked ? 'Flagged. Write a note about the issue.' : 'Flag cleared.'); }
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || $('shortcuts').open) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    // Also while typing: notes save on every keystroke, and this stops the browser's Back/Forward.
    if (!db.reviewer || !active) return; e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { if (!db.reviewer) return; e.preventDefault(); $('search').focus(); $('search').select(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === '?') { e.preventDefault(); $('shortcuts').showModal(); return; }
  if (e.key.toLowerCase() === 't') { e.preventDefault(); prefs.showTex = !prefs.showTex; applyPrefs(); savePrefs(); return; }
  if (!db.reviewer || !active) return;
  const key = e.key.toLowerCase();
  if (e.key === '/') { e.preventDefault(); $('search').focus(); $('search').select(); }
  else if (key === 'j') { e.preventDefault(); step(1); }
  else if (key === 'k') { e.preventDefault(); step(-1); }
  else if (key === 'u') { e.preventDefault(); nextOpen(); }
  else if (key === 'f') { e.preventDefault(); toggleFlag(); }
  else if (key === 'n') { e.preventDefault(); $('overall-notes')?.focus(); }
});

function applyTheme(theme) { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'; $('theme').setAttribute('aria-pressed', String(theme === 'dark')); }
try { applyTheme(localStorage.getItem('course-review-theme') || 'light'); } catch { applyTheme('light'); }
$('theme').onclick = () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(theme); try { localStorage.setItem('course-review-theme', theme); } catch { message('Theme changed for this visit. Browser storage is unavailable.'); } };
