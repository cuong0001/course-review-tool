/* Isolated multi-course preview UI controller. Does not touch DSA workspaces or DSA snapshots. */
'use strict';

const cfg = globalThis.CourseReviewConfig || {};
const DATA = globalThis[cfg.globalDataVar || 'CourseReviewData'];
if (!DATA) throw Error('CourseReviewData snapshot is missing.');
if (cfg.courseId && DATA.course_id !== cfg.courseId) {
  throw Error(`Snapshot course_id '${DATA.course_id}' does not match page course '${cfg.courseId}'.`);
}

const C = CourseReviewCore;
const $ = id => document.getElementById(id);
const storeKey = `course-review-workspaces-v2:${DATA.course_id}`;
const prefsKey = `course-review-prefs-v2:${DATA.course_id}`;

let db = { course_id: DATA.course_id, reviewer: '', people: {} };
let loaded = {}, active = '', session = new Set(), storageBroken = false;
let lastRows = [], undo = null, prefs = { scale: 1, showTex: false, focus: false };

const STATUS_LABEL = { unreviewed: 'Not started', 'in-progress': 'In progress', flagged: 'Flagged', 'stale-sources': 'Needs source check', finished: 'Finished' };
const DECISION_LABEL = { approve: 'Approved', revise: 'Needs changes', reject: 'Rejected' };
const isDone = s => Boolean(s.decision && !s.source_recheck_needed);
const formatStamp = iso => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

function message(text) { $('message').textContent = text; if (!text) $('undo').hidden = true; }
try {
  const raw = localStorage.getItem(storeKey);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!parsed.people || typeof parsed.people !== 'object' || (parsed.course_id && parsed.course_id !== DATA.course_id)) {
      throw Error('Invalid local save');
    }
    db = { course_id: DATA.course_id, ...parsed };
  }
} catch (e) {
  storageBroken = true;
  message('Could not restore local storage. Import your latest exported package.');
}

function workspace() { return db.people[db.reviewer]; }
function save() {
  try {
    if (workspace()) workspace().scope = $('assignment-scope').value;
    const remote = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (remote?.people && db.reviewer) db.people = { ...remote.people, [db.reviewer]: workspace() };
    db.course_id = DATA.course_id;
    localStorage.setItem(storeKey, JSON.stringify(db));
    storageBroken = false;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('saved').textContent = `Saved ${time}`; $('saved').className = 'muted';
  } catch (e) {
    storageBroken = true;
    $('saved').textContent = 'Not saved—export a backup'; $('saved').className = 'save-error';
  }
}

function nameRequired() { if (!db.reviewer) { message(`Choose your name to open your ${DATA.course_id} review workspace.`); return false; } return true; }
function state(k) { const w = workspace(); return w.states[k] || (w.states[k] = C.blank()); }
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function button(text, fn, cls) { const b = node('button', text, cls); b.type = 'button'; b.onclick = fn; return b; }
function link(parent, url) {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return false;
    const a = node('a', url); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    parent.append(a, node('br'));
    return true;
  } catch { return false; }
}
function urls(value) {
  const found = [];
  (function walk(v) {
    if (typeof v === 'string') found.push(...(v.match(/https?:\/\/[^\s<>"\\]+/g) || []));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(value);
  return [...new Set(found)];
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
async function fingerprint(record) { return digest(record); }
async function contentFingerprint(record) { return digest(globalThis.ReviewDiff ? ReviewDiff.stripSourcesAndIgnored(record) : record); }

function isSourceOnlyMatch(k, s, item, previousLoadedItem = null) {
  if (s.content_fingerprint && item.content_fingerprint && s.content_fingerprint === item.content_fingerprint) return true;
  if (previousLoadedItem && (!s.fingerprint || s.fingerprint === previousLoadedItem.fingerprint) && globalThis.ReviewDiff && ReviewDiff.isSourceOnlyChange(previousLoadedItem.record, item.record)) return true;
  const ch = changesFor(k);
  if (!s.content_fingerprint && ch?.source_only && ch?.fingerprint_before && s.fingerprint === ch.fingerprint_before) return true;
  return false;
}

function reconcileRecordState(k, item, previousLoadedItem = null) {
  const s = workspace()?.states?.[k];
  if (!s || !item || !s.fingerprint) return 'unchanged';
  if (s.fingerprint === item.fingerprint) {
    if (!s.content_fingerprint && item.content_fingerprint) { s.content_fingerprint = item.content_fingerprint; return 'backfilled'; }
    return 'unchanged';
  }
  if (isSourceOnlyMatch(k, s, item, previousLoadedItem)) {
    C.markSourcesStale(s); s.fingerprint = item.fingerprint; s.content_fingerprint = item.content_fingerprint; session.delete(k);
    return 'sources';
  }
  C.resetForContentChange(s); s.fingerprint = item.fingerprint; s.content_fingerprint = item.content_fingerprint; session.delete(k);
  return 'content';
}

function savePrefs() { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* ignore */ } }
function applyPrefs() {
  prefs.scale = Math.min(1.4, Math.max(0.85, Math.round(prefs.scale * 20) / 20));
  document.documentElement.style.fontSize = prefs.scale === 1 ? '' : `${prefs.scale * 100}%`;
  document.documentElement.classList.toggle('show-tex', prefs.showTex);
  document.documentElement.classList.toggle('focus-mode', prefs.focus);
  $('text-size').value = `${Math.round(prefs.scale * 100)}%`;
  $('show-tex').checked = prefs.showTex; $('focus-mode').checked = prefs.focus;
}
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(prefsKey) || '{}') }; } catch { /* defaults */ }
applyPrefs();

function detectKind(record) {
  const kinds = Object.keys(C.ids).filter(k => typeof record[C.ids[k]] === 'string');
  if (kinds.length !== 1) return null;
  return kinds[0];
}

function assertCourseRecordNamespace(record, id) {
  const prefix = cfg.idPrefix;
  if (!prefix) return;
  const tid = record.topic_id || (record.topic_ids && record.topic_ids[0]) || '';
  if (tid && !tid.startsWith(prefix)) throw Error(`Record ${id} belongs to topic '${tid}', not course prefix '${prefix}'.`);
}

async function loadFiles(files) {
  if (!nameRequired()) return;
  try {
    const pending = {};
    for (const file of files) {
      const text = await file.text(); let number = 0;
      for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        number++; if (!line.trim()) continue; let record;
        try { record = JSON.parse(line); } catch { throw Error(`${file.name}, line ${number}: invalid JSON`); }
        const kind = detectKind(record);
        if (!kind) throw Error(`${file.name}, line ${number}: unsupported record`);
        const id = record[C.ids[kind]], k = C.key(kind, id);
        assertCourseRecordNamespace(record, id);
        if (pending[k]) throw Error(`Duplicate ID ${id}`);
        pending[k] = { kind, id, record, fingerprint: await fingerprint(record), content_fingerprint: await contentFingerprint(record) };
      }
    }
    let changed = 0, staleCount = 0, resetCount = 0, notice = '';
    for (const [k, item] of Object.entries(pending)) {
      const before = loaded[k];
      if (before && before.fingerprint !== item.fingerprint && globalThis.ReviewDiff) {
        item.changes = { compared_with: before.bundled ? 'the bundled snapshot' : 'the previously loaded file', source_only: ReviewDiff.isSourceOnlyChange(before.record, item.record), fingerprint_before: before.fingerprint, fields: ReviewDiff.diffRecords(before.record, item.record) };
        changed++;
      } else if (before?.changes) item.changes = before.changes;
      loaded[k] = item;
      const outcome = reconcileRecordState(k, item, before);
      if (outcome === 'sources') { staleCount++; notice = `${item.id}: references changed; prior decision retained — recheck sources.`; }
      else if (outcome === 'content') { resetCount++; notice = `${item.id}: source content changed; notes retained, verification reset.`; }
    }
    if (staleCount > 1 && !resetCount) notice = `${staleCount} items have updated references; prior decisions retained — recheck sources.`;
    if (notice) message(notice);
    else if (changed && !$('message').textContent) message(`${changed} loaded records differ from what was shown before.`);
    save(); render();
  } catch (e) { message(`Import failed: ${e.message}`); } finally { $('files').value = ''; }
}

function status(s) { return s.source_recheck_needed ? 'stale-sources' : s.decision ? 'finished' : s.flag ? 'flagged' : s.updated_at ? 'in-progress' : 'unreviewed'; }
function changesFor(k) { const item = loaded[k]; return item?.changes || (item?.bundled ? DATA.changes?.[k] : null) || null; }
function auditFor(k) {
  const item = loaded[k], overlay = DATA.audit_overlay;
  if (!overlay || (overlay.course_id && overlay.course_id !== DATA.course_id)) return null;
  const entry = overlay.issues?.[k];
  return entry && item && JSON.stringify(entry.record) === JSON.stringify(item.record) ? entry : null;
}
function drawAudit(parent, k) {
  const audit = auditFor(k); if (!audit) return;
  const box = node('section', undefined, 'audit-notice'); box.setAttribute('aria-label', 'Audit findings');
  box.append(node('h3', 'Audit findings'), node('p', `Independent AI review (${DATA.audit_overlay?.checked_at_utc || 'latest'}). Check before approving.`));
  for (const finding of audit.findings) {
    const detail = node('details');
    const summary = node('summary', `${finding.field} · ${finding.severity || finding.status || 'note'}`);
    detail.append(summary, rich(finding.reason));
    box.append(detail);
  }
  parent.append(box);
}

function eligible() {
  return Object.entries(loaded)
    .filter(([, i]) => $('assignment-scope').value === 'all' || ReviewAssignments.belongs(DATA, i, db.reviewer))
    .filter(([, i]) => !['resource', 'activity'].includes(i.kind) || $('extras').checked)
    .filter(([, i]) => i.kind !== 'question' || ['pending', 'revise'].includes(i.record.human_review_status));
}

const fold = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const recordText = new WeakMap();
function searchable(k, item) {
  if (!recordText.has(item.record)) {
    const r = item.record, parts = [item.id, r.title, r.title_en, r.title_vi, r.stem, r.answer_explanation, r.problem_statement, ...(r.options || []).map(o => o.text), ...Object.values(r.distractor_explanations || {})];
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
    && (filter === 'all' || (filter === 'flagged' ? state(k).flag : filter === 'audit-issues' ? !!auditFor(k) : filter === 'changed' ? !!changesFor(k) : filter === 'stale-sources' ? !!state(k).source_recheck_needed : status(state(k)) === filter))
    && (!query || query.split(/\s+/).every(word => searchable(k, i).includes(word))))
    .sort((a, b) => ((a[1].record.topic_id || (a[1].record.topic_ids || [])[0] || '').localeCompare(b[1].record.topic_id || (b[1].record.topic_ids || [])[0] || '')) || a[1].id.localeCompare(b[1].id));
}

function chip(k) {
  const s = state(k), st = status(s);
  if (s.source_recheck_needed) {
    const text = s.decision ? `${DECISION_LABEL[s.decision]} · Recheck sources` : STATUS_LABEL[st];
    return node('span', text, `chip chip-${s.decision || st} chip-stale`);
  }
  return node('span', s.decision ? DECISION_LABEL[s.decision] : STATUS_LABEL[st], `chip chip-${s.decision || st}`);
}

function progress() {
  const all = eligible(), done = all.filter(([k]) => isDone(state(k))).length, stale = all.filter(([k]) => state(k).source_recheck_needed).length;
  const team = $('assignment-scope').value === 'all' ? ' · whole team' : '';
  $('progress').textContent = `${DATA.course_id} · ${db.reviewer}${team} · ${done} / ${all.length} done` + (stale ? ` · ${stale} need source check` : '');
}

function drawQueue(rows) {
  const queue = $('queue'); queue.replaceChildren();
  const filtered = $('search').value.trim() || $('filter').value !== 'all' || $('topic').value;
  const finished = rows.filter(([k]) => isDone(state(k))).length;
  $('queue-count').textContent = rows.length ? `${rows.length} ${filtered ? 'matching ' : ''}item${rows.length === 1 ? '' : 's'} · ${finished} finished` : '';
  $('rail-count').textContent = rows.length ? `${finished} / ${rows.length}` : '';
  for (const [k, i] of rows) {
    const b = button('', () => open(k), 'queue-item');
    b.append(document.createTextNode(`${i.id} · `), chip(k));
    if (auditFor(k)) b.append(node('span', ' Audit finding', 'chip chip-audit'));
    if (state(k).flag) b.append(node('span', ' ⚑', 'queue-flag'));
    const preview = node('span', undefined, 'queue-preview');
    ReviewRender.inline(preview, i.record.title || i.record.title_en || i.record.stem || '');
    b.append(preview);
    b.setAttribute('aria-current', String(k === active));
    queue.append(b);
  }
}

function render() {
  if (!db.reviewer) return;
  progress();
  const rows = items(), keys = rows.map(([k]) => k);
  if (!keys.includes(active)) {
    const old = lastRows.indexOf(active);
    active = (old >= 0 && lastRows.slice(old + 1).find(k => keys.includes(k))) || (old >= 0 && [...lastRows.slice(0, old)].reverse().find(k => keys.includes(k))) || keys[0] || '';
  }
  lastRows = keys; drawQueue(rows);
  if (active) { workspace().position = active; drawItem(rows); save(); }
  else {
    const empty = node('section', undefined, 'empty-state');
    empty.append(node('p', 'No items in this view. Try switching Assignment to Whole team, enabling resources/activities, or clearing filters.'));
    if ($('search').value || $('filter').value !== 'all' || $('topic').value) empty.append(button('Clear search and filters', clearFilters));
    $('item').className = ''; $('item').replaceChildren(empty);
  }
}

function open(k, { focus = false } = {}) {
  active = k; workspace().position = k; save(); render();
  $('item').scrollIntoView({ block: 'start' });
  if (focus) $('item').focus({ preventScroll: true });
}
function step(delta) { const i = lastRows.indexOf(active), k = lastRows[i + delta]; if (k) open(k); }
function nextOpenKey() { const i = lastRows.indexOf(active); return [...lastRows.slice(i + 1), ...lastRows.slice(0, Math.max(i, 0))].find(k => !isDone(state(k))) || null; }
function nextOpen() { const k = nextOpenKey(); if (k) open(k); else message('Everything in this queue is finished.'); }
function clearFilters() { $('search').value = ''; $('filter').value = 'all'; $('topic').value = ''; render(); }

function autosize(t, min = 120) { t.style.height = 'auto'; t.style.height = `${Math.max(t.scrollHeight + 2, min)}px`; }
function note(parent, label, value, onchange, { id, placeholder = '', cls = '', min = 120 } = {}) {
  const t = node('textarea', undefined, cls); t.rows = 1; t.value = value; t.placeholder = placeholder; t.setAttribute('aria-label', label); if (id) t.id = id;
  t.addEventListener('input', () => { onchange(t.value); autosize(t, min); }); parent.append(t);
  requestAnimationFrame(() => autosize(t, min)); return t;
}
function edited(k, field, value) {
  const s = state(k); C.edit(s, field, value); s.fingerprint = loaded[k].fingerprint; s.content_fingerprint = loaded[k].content_fingerprint; session.delete(k);
  if (undo?.key === k) { undo = null; $('undo').hidden = true; }
  save(); progress(); updateActions(); decisionStatus(s);
  $('stale-source-banner')?.remove();
  const entry = [...$('queue').children].find(b => b.getAttribute('aria-current') === 'true');
  if (entry) entry.querySelector('.chip')?.replaceWith(chip(k));
  document.querySelector('#item .content-navigation .meta .chip')?.replaceWith(chip(k));
}
function detail(parent, value, label = 'Details') {
  if (value === undefined || value === null) return;
  if (typeof value === 'object') {
    if (Array.isArray(value)) { for (const [index, v] of value.entries()) detail(parent, v, `${label} ${index + 1}`); }
    else { for (const [k, v] of Object.entries(value)) detail(parent, v, k.replaceAll('_', ' ')); }
  } else parent.append(node('strong', label), rich(String(value)));
}
function drawBlock(parent, block) {
  const section = ReviewRender.block(parent, block), value = state(active).sections[block.id] || '';
  const t = note(section, 'Notes for section ' + block.id, value, v => edited(active, 'sections', { ...state(active).sections, [block.id]: v }), { placeholder: 'Note on this section…', cls: 'section-note', min: 38 });
  const add = button('+ Note', () => { section.classList.add('noting'); autosize(t, 38); t.focus(); }, 'add-note');
  add.setAttribute('aria-label', 'Add a note for section ' + block.id); section.prepend(add);
  if (value.trim()) section.classList.add('noting');
  t.addEventListener('blur', () => { if (!t.value.trim()) section.classList.remove('noting'); });
}
function rich(text, className = '') { const element = node('div', undefined, className); ReviewRender.prose(element, text); return element; }
function decisionStatus(s) {
  const el = $('decision-status'); if (!el) return;
  if (!s.decision) { el.textContent = ''; el.className = 'status'; return; }
  const stamp = formatStamp(s.decided_at);
  if (s.source_recheck_needed) {
    el.textContent = `Previous decision: ${DECISION_LABEL[s.decision]} · ${stamp} (references changed — recheck needed)`;
    el.className = 'status stale';
  } else {
    el.textContent = `${DECISION_LABEL[s.decision]} · ${stamp}` + (s.source_rechecked_at ? ` · Sources confirmed ${formatStamp(s.source_rechecked_at)}` : '');
    el.className = 'status' + (s.decision === 'approve' ? ' done' : '');
  }
}

function drawItem(rows) {
  reconcileRecordState(active, loaded[active]);
  const { kind, id, record: r } = loaded[active], s = state(active);
  if (!s.fingerprint) { s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint; }
  else if (!s.content_fingerprint && loaded[active].content_fingerprint) s.content_fingerprint = loaded[active].content_fingerprint;
  const panel = $('item'), content = node('section', undefined, 'review-content'), review = node('aside', undefined, 'review-panel');
  panel.className = 'item-layout'; panel.replaceChildren(content, review); review.setAttribute('aria-label', 'Your review');

  const index = rows.findIndex(([k]) => k === active), nav = node('div', undefined, 'content-navigation'), meta = node('div', undefined, 'meta');
  const topic = r.topic_id || (r.topic_ids || []).join(', ');
  if (kind === 'question') { const h = node('h2', id, 'item-id'); h.title = topic; meta.append(h); }
  else meta.append(node('span', `${id}${topic ? ' · ' + topic : ''}`));
  meta.append(chip(active));
  const prev = button('‹', () => step(-1)), next = button('›', () => step(1));
  prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next');
  prev.disabled = index <= 0; next.disabled = index >= rows.length - 1;
  const nextUnfinished = button('Next unfinished', nextOpen, 'next-open'); nextUnfinished.disabled = !nextOpenKey();
  nav.append(meta, prev, node('span', `${index + 1} / ${rows.length}`, 'position'), next, nextUnfinished); content.append(nav);
  if (kind !== 'question') content.append(node('h2', r.title || r.title_en || id));

  drawAudit(content, active);
  if (kind === 'question') {
    content.append(rich(r.stem, 'question-stem')); const options = node('div', undefined, 'answer-options');
    for (const option of r.options || []) {
      const correct = option.option_id === r.correct_option_id, card = node('section', undefined, correct ? 'correct' : 'option'), heading = node('div', undefined, 'option-heading'), body = node('div', undefined, 'option-copy');
      const letter = node('span', correct ? `${option.option_id} ✓` : option.option_id, 'option-letter');
      body.append(rich(option.text)); heading.append(letter, body); card.append(heading);
      if (!correct) card.append(rich(r.distractor_explanations?.[option.option_id] || 'Missing distractor explanation', 'distractor-note'));
      options.append(card);
    }
    const explanation = node('section', undefined, 'explanation'); explanation.append(node('h3', 'Explanation'), rich(r.answer_explanation));
    content.append(options, explanation);
  } else if (kind === 'lesson') {
    for (const block of r.blocks || []) drawBlock(content, block);
  } else if (kind === 'activity' && r.reference_solution && typeof r.reference_solution === 'object') {
    // Activity v2 rendering
    for (const [field, value] of Object.entries(r)) {
      if (['approved_by', 'approved_at', 'reviewer_comment', 'human_review_status', 'review_status', 'reference_solution'].includes(field)) continue;
      detail(content, value, field.replaceAll('_', ' '));
    }
    content.append(node('h3', `reference solution (${r.reference_solution.language || 'text'})`));
    ReviewRender.code(content, r.reference_solution.content || '', r.reference_solution.language || '');
  } else {
    for (const [field, value] of Object.entries(r)) if (!['approved_by', 'approved_at', 'reviewer_comment', 'human_review_status', 'review_status'].includes(field)) {
      if (/code|solution_cpp/.test(field) && typeof value === 'string') { content.append(node('h3', field.replaceAll('_', ' '))); ReviewRender.code(content, value); }
      else detail(content, value, field.replaceAll('_', ' '));
    }
  }

  const refs = node('section', undefined, 'sources'); refs.append('Sources: ');
  const sourceUrls = urls(r); sourceUrls.forEach(url => link(refs, url));
  if (!sourceUrls.length || (r.source_ids || []).some(value => value.startsWith('editorial_source_'))) {
    refs.append(node('p', 'NO REAL SOURCE', 'warning'));
  }
  if (['video', 'resource'].includes(kind)) {
    refs.append(node('p', `License: ${r.license_name || r.license?.name || 'MISSING — verify permitted use'}`, r.license_name || r.license?.name ? '' : 'warning'));
  }
  content.append(refs);

  note(review, 'Overall notes / what should be fixed', s.notes, value => edited(active, 'notes', value), { id: 'overall-notes', placeholder: 'Notes: what should change? (N)' });
  const flagLabel = node('label', ' Flag an issue'), flag = node('input'); flagLabel.className = 'check-label flag-label';
  flag.type = 'checkbox'; flag.id = 'flag'; flag.checked = s.flag; flag.onchange = () => edited(active, 'flag', flag.checked); flagLabel.prepend(flag); review.append(flagLabel);
  const actions = node('div', undefined, 'toolbar');
  for (const [choice, label] of [['approve', 'Approve'], ['revise', 'Needs changes'], ['reject', 'Reject']]) {
    const action = button(label, () => decide(kind, choice)); action.id = choice; if (choice === 'approve') action.className = 'primary'; actions.append(action);
  }
  actions.querySelector('#approve').title = 'Approving confirms:\n• ' + Object.values(C.checks[kind]).join('\n• ');
  const help = node('p', '', 'decision-help'); help.id = 'decision-help'; help.setAttribute('aria-live', 'polite');
  const current = node('p', '', 'status'); current.id = 'decision-status'; current.setAttribute('aria-live', 'polite');
  if (s.source_recheck_needed) {
    const banner = node('div', undefined, 'stale-source-banner'); banner.id = 'stale-source-banner';
    const summary = s.decision ? `Retained prior decision: ${DECISION_LABEL[s.decision]} (${formatStamp(s.decided_at)}). The references have changed and need to be checked again.` : 'The references have changed and need to be checked again.';
    banner.append(node('p', summary));
    if (s.decision) {
      const confirmBtn = button('Confirm new sources', () => confirmSourcesAction(kind), 'confirm-sources');
      confirmBtn.id = 'confirm-sources'; confirmBtn.classList.add('primary');
      banner.append(confirmBtn);
    }
    review.append(banner);
  }
  review.append(actions, help, current);
  decisionStatus(s); updateActions();
}

function confirmSourcesAction(kind) {
  const before = structuredClone(state(active));
  try {
    const s = state(active); C.confirmSources(s, kind);
    s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint;
    session.add(active); undo = { key: active, state: before, reviewer: db.reviewer };
    save(); render(); message('New references confirmed; original decision and timestamp kept.'); $('undo').hidden = false;
  } catch (error) { message(error.message); }
}
function decide(kind, choice) {
  const before = structuredClone(state(active));
  try {
    const s = state(active);
    if (choice === 'approve' && !s.flag) C.edit(s, 'checks', Object.fromEntries(Object.keys(C.checks[kind]).map(k => [k, true])));
    C.finalize(s, kind, choice);
    s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint;
    session.add(active); undo = { key: active, state: before, reviewer: db.reviewer };
    save(); render(); message(`${DECISION_LABEL[choice]}.`); $('undo').hidden = false;
  } catch (error) { message(error.message); }
}
function updateActions() {
  if (!active || !$('approve')) return;
  const s = state(active), hasNote = !!C.comment(s).trim();
  $('approve').disabled = s.flag; $('revise').disabled = $('reject').disabled = !hasNote;
  $('decision-help').textContent = s.flag ? 'Clear the flag to approve.' : '';
}
function download(value, filename) {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
    const a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(`Export requested: ${filename}.`);
  } catch (e) { message(`Export failed: ${e.message}`); }
}

function selectReviewer(name) {
  if (name && !Array.from($('reviewer').options).some(o => o.value === name)) $('reviewer').append(new Option(name + ' (saved/imported)', name));
  $('reviewer').value = name;
}
function reconcileWorkspace() {
  if (!workspace()) return;
  let staleCount = 0, resetCount = 0, backfilled = 0;
  for (const key of Object.keys(workspace().states)) {
    const outcome = reconcileRecordState(key, loaded[key]);
    if (outcome === 'sources') staleCount++;
    else if (outcome === 'content') resetCount++;
    else if (outcome === 'backfilled') backfilled++;
  }
  if (staleCount || resetCount || backfilled) save();
  if (staleCount) message(`${staleCount} item(s) have updated references; prior decisions retained for recheck.`);
  else if (resetCount) message(`${resetCount} item(s) had content changes; notes retained, verification reset.`);
}

async function loadBundled() {
  for (const record of DATA.records) {
    const kind = detectKind(record), id = record[C.ids[kind]];
    loaded[C.key(kind, id)] = { kind, id, record, fingerprint: await fingerprint(record), content_fingerprint: await contentFingerprint(record), bundled: true };
  }
  const s = DATA.summary;
  $('dataset-summary').textContent = `${DATA.course_id} — ${DATA.course_name} (v${DATA.dataset_version}): ${s.pending_questions} pending questions, ${s.lessons} lessons, ${s.resources} resources, ${s.activities} activities.`;
  reconcileWorkspace();
  if (db.reviewer) { active = workspace().position; $('type').value = loaded[active]?.kind || 'lesson'; render(); }
}

const bundledReady = loadBundled();
$('reviewer').onchange = async () => { await openWorkspace(); };
async function openWorkspace() {
  await bundledReady; const name = $('reviewer').value.trim(); if (!name) return;
  db.reviewer = name;
  if (!Object.hasOwn(db.people, name)) Object.defineProperty(db.people, name, { value: { states: {}, position: '' }, enumerable: true, writable: true, configurable: true });
  $('assignment-scope').value = 'all';
  reconcileWorkspace(); active = workspace().position; $('topic').value = ''; $('filter').value = 'all'; $('search').value = ''; $('type').value = loaded[active]?.kind || 'lesson';
  session = new Set(); undo = null; $('undo').hidden = true; lastRows = []; save(); render();
}

$('files').onchange = e => loadFiles(e.target.files);
$('export').onclick = () => {
  if (!nameRequired()) return;
  download(C.exportCoursePackage(db.reviewer, workspace(), DATA.course_id, DATA), `review-${DATA.course_id}-${db.reviewer}.json`);
};
$('decisions').onclick = () => {
  if (!nameRequired()) return;
  download(C.courseDecisions(db.reviewer, workspace().states, Object.fromEntries(eligible()), DATA.course_id), `decisions-${DATA.course_id}.json`);
};
$('import').onchange = async e => {
  try {
    await bundledReady;
    const p = C.validateCoursePackage(JSON.parse(await e.target.files[0].text()), DATA.course_id);
    db.reviewer = p.reviewer;
    if (!Object.hasOwn(db.people, p.reviewer)) Object.defineProperty(db.people, p.reviewer, { value: { states: {}, position: p.position || '' }, enumerable: true, writable: true, configurable: true });
    for (const i of p.items) {
      const k = C.key(i.item_type, i.id);
      workspace().states[k] = structuredClone(i.state);
      reconcileRecordState(k, loaded[k]);
    }
    selectReviewer(p.reviewer); active = workspace().position; save(); render();
    message(`Package restored for ${DATA.course_id}.`);
  } catch (err) { message(`Import failed: ${err.message}`); } finally { e.target.value = ''; }
};

for (const id of ['type', 'topic', 'filter', 'extras', 'assignment-scope']) $(id).onchange = () => render();
$('search').addEventListener('input', render);
$('clear-filters').onclick = () => { if (nameRequired()) clearFilters(); };
$('undo').onclick = () => {
  if (!undo || undo.reviewer !== db.reviewer) { $('undo').hidden = true; return; }
  workspace().states[undo.key] = undo.state; active = undo.key; undo = null; save(); render(); $('undo').hidden = true;
};

const originalRender = render;
render = function () {
  const previous = $('topic').value;
  const topics = [...new Set(eligible().flatMap(([, i]) => [i.record.topic_id, ...(i.record.topic_ids || [])]).filter(Boolean))].sort();
  $('topic').replaceChildren(new Option('All topics', ''), ...topics.map(t => new Option(t, t)));
  $('topic').value = topics.includes(previous) ? previous : '';
  originalRender();
};

$('text-smaller').onclick = () => { prefs.scale -= 0.05; applyPrefs(); savePrefs(); };
$('text-larger').onclick = () => { prefs.scale += 0.05; applyPrefs(); savePrefs(); };
$('show-tex').onchange = () => { prefs.showTex = $('show-tex').checked; applyPrefs(); savePrefs(); };
$('focus-mode').onchange = () => { prefs.focus = $('focus-mode').checked; applyPrefs(); savePrefs(); };
$('shortcuts-open').onclick = () => $('shortcuts').showModal();
document.addEventListener('click', e => { if ($('view-menu').open && !$('view-menu').contains(e.target)) $('view-menu').open = false; });
$('view-menu').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('view-menu').open = false; $('view-menu').querySelector('summary').focus(); } });
function applyTheme(theme) { document.documentElement.dataset.theme = theme; $('theme').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'; $('theme').setAttribute('aria-pressed', String(theme === 'dark')); }
try { applyTheme(localStorage.getItem('course-review-theme-v2') || 'light'); } catch { applyTheme('light'); }
$('theme').onclick = () => { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(theme); try { localStorage.setItem('course-review-theme-v2', theme); } catch { /* ignore */ } };
selectReviewer(db.reviewer || '');
if (db.reviewer) { active = workspace()?.position || ''; render(); }
