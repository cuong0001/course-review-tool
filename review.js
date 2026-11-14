/* UI reads only the bundled snapshot and files the reviewer selects. No dataset writes or network fetches. */
'use strict';
const C = ReviewCore, $ = id => document.getElementById(id);
const storeKey = 'course-review-workspaces-v1', prefsKey = 'course-review-prefs-v1';
let db = {reviewer: '', people: {}}, loaded = {}, active = '', session = new Set(), storageBroken = false;
let lastRows = [], undo = null, prefs = {scale: 1, showTex: false, focus: false};
const STATUS_LABEL = {unreviewed: 'Not started', 'in-progress': 'In progress', flagged: 'Flagged', 'stale-sources': 'Needs source check', finished: 'Finished'};
const DECISION_LABEL = {approve: 'Approved', revise: 'Needs changes', reject: 'Rejected'};
const isDone = s => Boolean(s.decision && !s.source_recheck_needed);
const formatStamp = iso => new Date(iso).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'});

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
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    $('saved').textContent = `Saved ${time}`; $('saved').className = 'muted';
    $('saved').title = 'Saved in this browser only. Export a backup before leaving.';
  } catch (e) { storageBroken = true; $('saved').textContent = 'Not saved—export a backup'; $('saved').className = 'save-error'; }
}
function nameRequired() { if (!db.reviewer) { message('Choose your name to open your assigned DSA workspace.'); return false; } return true; }
function state(k) { const w = workspace(); return w.states[k] || (w.states[k] = C.blank()); }
function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function button(text, fn, cls) { const b = node('button', text, cls); b.type = 'button'; b.onclick = fn; return b; }
function link(parent, url) { try { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol)) return false; const a = node('a', url); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a, node('br')); return true; } catch { return false; } }
function urls(value) { const found = []; (function walk(v) { if (typeof v === 'string') found.push(...(v.match(/https?:\/\/[^\s<>"\\]+/g) || [])); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(value); return [...new Set(found)]; }
async function digest(value) { const bytes = new TextEncoder().encode(JSON.stringify(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''); }
async function fingerprint(record) { return digest(record); }
async function contentFingerprint(record) { return digest(globalThis.ReviewDiff ? ReviewDiff.stripSourcesAndIgnored(record) : record); }
function isSourceOnlyMatch(k, s, item, previousLoadedItem = null) {
  if (s.content_fingerprint && item.content_fingerprint && s.content_fingerprint === item.content_fingerprint) return true;
  if (previousLoadedItem && (!s.fingerprint || s.fingerprint === previousLoadedItem.fingerprint) && globalThis.ReviewDiff && ReviewDiff.isSourceOnlyChange(previousLoadedItem.record, item.record)) return true;
  const ch = changesFor(k);
  if (!s.content_fingerprint && ch?.source_only && ch?.fingerprint_before && s.fingerprint === ch.fingerprint_before) return true;
  const priors = item.bundled ? DSAReviewData.prior_source_only_fingerprints?.[k] : null;
  if (!s.content_fingerprint && Array.isArray(priors) && priors.includes(s.fingerprint)) return true;
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
        pending[k] = {kind, id, record, fingerprint: await fingerprint(record), content_fingerprint: await contentFingerprint(record)};
      }
    }
    let changed = 0, staleCount = 0, resetCount = 0, notice = '';
    for (const [k, item] of Object.entries(pending)) {
      const before = loaded[k];
      if (before && before.fingerprint !== item.fingerprint) {
        // Without review-diff.js (an incomplete copy of the folder) files still load; only the comparison is skipped.
        if (globalThis.ReviewDiff) { item.changes = {compared_with: before.bundled ? 'the bundled snapshot' : 'the previously loaded file', source_only: ReviewDiff.isSourceOnlyChange(before.record, item.record), fingerprint_before: before.fingerprint, fields: ReviewDiff.diffRecords(before.record, item.record)}; changed++; }
      } else if (before?.changes) item.changes = before.changes;
      loaded[k] = item;
      const outcome = reconcileRecordState(k, item, before);
      if (outcome === 'sources') { staleCount++; notice = `${item.id}: references changed; prior decision retained — recheck sources.`; }
      else if (outcome === 'content') { resetCount++; notice = `${item.id}: source content changed; notes retained, verification reset.`; }
    }
    if (staleCount > 1 && !resetCount) notice = `${staleCount} items have updated references; prior decisions retained — recheck sources.`;
    if (notice) message(notice);
    else if (changed && !$('message').textContent) message(`${changed} loaded records differ from what was shown before; open one to see what changed.`);
    save(); render();
  } catch (e) { message(`Import failed: ${e.message}`); } finally { $('files').value = ''; }
}

// ------------------------------------------------------------------ queue
function status(s) { return s.source_recheck_needed ? 'stale-sources' : s.decision ? 'finished' : s.flag ? 'flagged' : s.updated_at ? 'in-progress' : 'unreviewed'; }
function changesFor(k) { const item = loaded[k]; return item?.changes || (item?.bundled ? DSAReviewData.changes?.[k] : null) || null; }
function auditFor(k) {
  const item = loaded[k], entry = globalThis.DSAReviewData?.audit_overlay?.issues?.[k];
  // Never show an old finding against a changed/imported record.
  return entry && item && JSON.stringify(entry.record) === JSON.stringify(item.record) ? entry : null;
}
function drawAudit(parent, k) {
  const audit = auditFor(k); if (!audit) return;
  const box = node('section', undefined, 'audit-notice'); box.setAttribute('aria-label', 'Audit findings');
  box.append(node('h3', 'Audit: needs clarification'), node('p', 'AI audit · 14 Nov 2026. Check these findings before approving. Your saved decision and notes have not been changed.'));
  for (const finding of audit.findings) {
    const detail = node('details'), summary = node('summary', finding.field.replace('distractor_explanations.', 'Why option ') + (finding.status === 'contradicted' ? ' · Contradiction found' : ' · Clarification needed'));
    detail.append(summary, rich(finding.reason)); box.append(detail);
  }
  parent.append(box);
}
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
  return recordText.get(item.record) + (auditFor(k) ? '\n' + fold(auditFor(k).findings.map(f => f.reason).join(' ')) : '') + (s ? '\n' + fold([s.notes, ...Object.values(s.sections)].join('\n')) : '');
}
function items() {
  const topic = $('topic').value, filter = $('filter').value, query = fold($('search').value).trim();
  return eligible().filter(([k, i]) => i.kind === $('type').value
      && (!topic || [i.record.topic_id, ...(i.record.topic_ids || [])].includes(topic))
      && (filter === 'all' || (filter === 'flagged' ? state(k).flag : filter === 'audit-issues' ? !!auditFor(k) : filter === 'changed' ? !!changesFor(k) : filter === 'stale-sources' ? !!state(k).source_recheck_needed : status(state(k)) === filter))
      && (!query || query.split(/\s+/).every(word => searchable(k, i).includes(word))))
    .sort((a, b) => { const rank = i => i.record.human_review_status === 'revise' ? 1 : 0; return rank(a[1]) - rank(b[1]) || (a[1].record.topic_id || '').localeCompare(b[1].record.topic_id || '') || a[1].id.localeCompare(b[1].id); });
}
function chip(k) {
  const s = state(k), st = status(s);
  if (s.source_recheck_needed) {
    const text = s.decision ? `${DECISION_LABEL[s.decision]} · Recheck sources` : STATUS_LABEL[st];
    return node('span', text, `chip chip-${s.decision || st} chip-stale`);
  }
  const text = s.decision ? DECISION_LABEL[s.decision] : STATUS_LABEL[st];
  return node('span', text, `chip chip-${s.decision || st}`);
}
function progress() {
  // One line in the header: whose work, and how much of it is finished. Per-type counts are in the tooltip.
  const all = eligible(), done = all.filter(([k]) => isDone(state(k))).length, stale = all.filter(([k]) => state(k).source_recheck_needed).length;
  const perKind = Object.keys(C.ids).map(kind => [kind, all.filter(([, i]) => i.kind === kind)]).filter(([, rows]) => rows.length)
    .map(([kind, rows]) => `${kind}: ${rows.filter(([k]) => isDone(state(k))).length} / ${rows.length}`);
  const team = $('assignment-scope').value === 'all' ? ' · whole team' : '';
  $('progress').textContent = `${db.reviewer}${team} · ${done} / ${all.length} done` + (stale ? ` · ${stale} need source check` : '');
  $('progress').title = perKind.join('\n') + `\n${session.size} finished this session` + (stale ? `\n${stale} awaiting source recheck` : '');
}
function drawQueue(rows) {
  const queue = $('queue'); queue.replaceChildren();
  const filtered = $('search').value.trim() || $('filter').value !== 'all' || $('topic').value;
  const finished = rows.filter(([k]) => isDone(state(k))).length;
  $('queue-count').textContent = rows.length ? `${rows.length} ${filtered ? 'matching ' : ''}item${rows.length === 1 ? '' : 's'} · ${finished} finished` : '';
  $('rail-count').textContent = rows.length ? `${finished} / ${rows.length}` : '';
  let current = null;
  for (const [k, i] of rows) {
    const b = button('', () => open(k), 'queue-item');
    b.append(document.createTextNode(`${i.id} · `), chip(k));
    if (auditFor(k)) b.append(node('span', ' Audit finding', 'chip chip-audit'));
    if (state(k).flag) b.append(node('span', ' ⚑', 'queue-flag'));
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
  return [...lastRows.slice(i + 1), ...lastRows.slice(0, Math.max(i, 0))].find(k => !isDone(state(k))) || null;
}
function nextOpen() { const k = nextOpenKey(); if (k) open(k); else message('Everything in this queue is finished.'); }
function clearFilters() { $('search').value = ''; $('filter').value = 'all'; $('topic').value = ''; render(); }

// ------------------------------------------------------------------ the current item
function autosize(t, min = 120) { t.style.height = 'auto'; t.style.height = `${Math.max(t.scrollHeight + 2, min)}px`; }
function note(parent, label, value, onchange, {id, placeholder = '', cls = '', min = 120} = {}) {
  // The label is for screen readers; the placeholder says what to write.
  const t = node('textarea', undefined, cls); t.rows = 1; t.value = value; t.placeholder = placeholder; t.setAttribute('aria-label', label); if (id) t.id = id;
  t.addEventListener('input', () => { onchange(t.value); autosize(t, min); }); parent.append(t);
  requestAnimationFrame(() => autosize(t, min)); return t;
}
function edited(k, field, value) {
  const s = state(k); C.edit(s, field, value); s.fingerprint = loaded[k].fingerprint; s.content_fingerprint = loaded[k].content_fingerprint; session.delete(k);
  // Undo restores a whole saved state, so it must never be offered after newer edits to the same item.
  if (undo?.key === k) { undo = null; $('undo').hidden = true; }
  save(); progress(); updateActions(); decisionStatus(s);
  $('stale-source-banner')?.remove();
  const entry = [...$('queue').children].find(b => b.getAttribute('aria-current') === 'true');
  if (entry) entry.querySelector('.chip')?.replaceWith(chip(k));
  document.querySelector('#item .content-navigation .meta .chip')?.replaceWith(chip(k));
}
function detail(parent, value, label = 'Details') {
  if (value === undefined || value === null) return;
  if (typeof value === 'object') { if (Array.isArray(value)) { for (const [index, v] of value.entries()) detail(parent, v, `${label} ${index + 1}`); } else { for (const [k, v] of Object.entries(value)) detail(parent, v, k.replaceAll('_', ' ')); } }
  else parent.append(node('strong', label), rich(String(value)));
}
function drawBlock(parent, block) {
  // A section note takes no space until it is used: "+ Note" appears on hover, the box stays once it has text.
  const section = ReviewRender.block(parent, block), value = state(active).sections[block.id] || '';
  const t = note(section, 'Notes for section ' + block.id, value, v => edited(active, 'sections', {...state(active).sections, [block.id]: v}),
    {placeholder: 'Note on this section…', cls: 'section-note', min: 38});
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
  const {kind, id, record: r} = loaded[active], s = state(active);
  if (!s.fingerprint) { s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint; }
  else if (!s.content_fingerprint && loaded[active].content_fingerprint) s.content_fingerprint = loaded[active].content_fingerprint;
  const panel = $('item'), content = node('section', undefined, 'review-content'), review = node('aside', undefined, 'review-panel');
  panel.className = 'item-layout'; panel.replaceChildren(content, review); review.setAttribute('aria-label', 'Your review');

  // One quiet line: what this is, where it is in the queue, and how to move.
  const index = rows.findIndex(([k]) => k === active), nav = node('div', undefined, 'content-navigation'), meta = node('div', undefined, 'meta');
  const topic = r.topic_id || (r.topic_ids || []).join(', ');
  if (kind === 'question') { const h = node('h2', id, 'item-id'); h.title = topic; meta.append(h); }
  else meta.append(node('span', `${id}${topic ? ' · ' + topic : ''}`));
  meta.append(chip(active));
  const prev = button('‹', () => step(-1)), next = button('›', () => step(1));
  prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next'); prev.title = 'Previous (Alt + ←)'; next.title = 'Next (Alt + →)';
  prev.disabled = index <= 0; next.disabled = index >= rows.length - 1;
  const nextUnfinished = button('Next unfinished', nextOpen, 'next-open'); nextUnfinished.disabled = !nextOpenKey(); nextUnfinished.title = 'U';
  nav.append(meta, prev, node('span', `${index + 1} / ${rows.length}`, 'position'), next, nextUnfinished); content.append(nav);
  if (kind !== 'question') content.append(node('h2', r.title || r.lecture_title || r.title_en || id));

  drawAudit(content, active);
  if (kind === 'question') {
    content.append(rich(r.stem, 'question-stem')); const options = node('div', undefined, 'answer-options');
    for (const option of r.options || []) {
      const correct = option.option_id === r.correct_option_id, card = node('section', undefined, correct ? 'correct' : 'option'), heading = node('div', undefined, 'option-heading'), body = node('div', undefined, 'option-copy');
      const letter = node('span', correct ? `${option.option_id} ✓` : option.option_id, 'option-letter'); if (correct) letter.title = 'Correct answer';
      body.append(rich(option.text)); heading.append(letter, body); card.append(heading);
      if (!correct) card.append(rich(r.distractor_explanations?.[option.option_id] || 'Missing distractor explanation', 'distractor-note'));
      options.append(card);
    }
    const explanation = node('section', undefined, 'explanation'); explanation.append(node('h3', 'Explanation'), rich(r.answer_explanation));
    content.append(options, explanation);
  } else if (kind === 'lesson') { for (const block of r.blocks || []) drawBlock(content, block); }
  else for (const [field, value] of Object.entries(r)) if (!['approved_by', 'approved_at', 'reviewer_comment', 'human_review_status', 'review_status'].includes(field)) {
    if (/code|solution_cpp/.test(field) && typeof value === 'string') { content.append(node('h3', field.replaceAll('_', ' '))); ReviewRender.code(content, value); }
    else detail(content, value, field.replaceAll('_', ' '));
  }
  const refs = node('section', undefined, 'sources'); refs.append('Sources: '); const sourceUrls = urls(r); sourceUrls.forEach(url => link(refs, url));
  if (kind === 'video' && r.video_id) link(refs, `https://www.youtube.com/watch?v=${encodeURIComponent(r.video_id)}&t=${r.start_seconds || 0}s`);
  if (!sourceUrls.length || (r.source_ids || []).some(value => value.startsWith('editorial_source_'))) refs.append(node('p', `NO REAL SOURCE${r.source_ids?.length ? ': ' + r.source_ids.join(', ') : ''}`, 'warning'));
  if (['video', 'resource'].includes(kind)) refs.append(node('p', `License: ${r.license_name || r.license?.name || 'MISSING — verify permitted use'}`, r.license_name || r.license?.name ? '' : 'warning'));
  content.append(refs);

  // Review: a note, an optional flag, and the decision. Approving confirms the checklist in the button's tooltip.
  note(review, 'Overall notes / what should be fixed', s.notes, value => edited(active, 'notes', value), {id: 'overall-notes', placeholder: 'Notes: what should change? (N)'});
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
    const summary = s.decision
      ? `Retained prior decision: ${DECISION_LABEL[s.decision]} (${formatStamp(s.decided_at)}). The references have changed and need to be checked again.`
      : 'The references have changed and need to be checked again.';
    banner.append(node('p', summary));
    if (s.decision === 'approve') banner.append(node('p', 'Content checks preserved; source verification reset.', 'stale-source-meta'));
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
    const s = state(active);
    C.confirmSources(s, kind);
    s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint;
    session.add(active);
    undo = {key: active, state: before, reviewer: db.reviewer};
    save(); render();
    message('New references confirmed; original decision and timestamp kept.'); $('undo').hidden = false;
  } catch (error) { message(error.message); }
}
function decide(kind, choice) {
  const before = structuredClone(state(active));
  try {
    const s = state(active);
    // "Approve" is the reviewer confirming every check for this item type; a flag still blocks it.
    if (choice === 'approve' && !s.flag) C.edit(s, 'checks', Object.fromEntries(Object.keys(C.checks[kind]).map(k => [k, true])));
    C.finalize(s, kind, choice);
    s.fingerprint = loaded[active].fingerprint; s.content_fingerprint = loaded[active].content_fingerprint;
    session.add(active);
    undo = {key: active, state: before, reviewer: db.reviewer};
    save(); render();
    message(`${DECISION_LABEL[choice]}.`); $('undo').hidden = false;
  } catch (error) { message(error.message); }
}
function updateActions() {
  if (!active || !$('approve')) return;
  const s = state(active), hasNote = !!C.comment(s).trim();
  $('approve').disabled = s.flag; $('revise').disabled = $('reject').disabled = !hasNote;
  $('decision-help').textContent = s.flag ? 'Clear the flag to approve.' : '';
  for (const b of [$('revise'), $('reject')]) b.title = hasNote ? '' : 'Write a note first';
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
  let staleCount = 0, resetCount = 0, backfilled = 0;
  for (const key of Object.keys(workspace().states)) {
    const outcome = reconcileRecordState(key, loaded[key]);
    if (outcome === 'sources') staleCount++;
    else if (outcome === 'content') resetCount++;
    else if (outcome === 'backfilled') backfilled++;
  }
  if (staleCount && resetCount) message(`${staleCount} items have updated references (prior decisions retained for recheck); ${resetCount} had content changes (notes retained, verification reset).`);
  else if (staleCount) message('References changed; prior decision retained — recheck sources.');
  else if (resetCount) message('Source content changed; notes retained, verification reset.');
  if (staleCount || resetCount || backfilled) save();
}
async function loadBundled() {
  try {
    for (const record of DSAReviewData.records) { const kind = record.question_id ? 'question' : 'lesson', id = record[C.ids[kind]]; loaded[C.key(kind, id)] = {kind, id, record, fingerprint: await fingerprint(record), content_fingerprint: await contentFingerprint(record), bundled: true}; }
    const summary = DSAReviewData.summary, changed = Object.keys(DSAReviewData.changes || {}).length;
    $('dataset-summary').textContent = `${summary.approved_questions} approved questions excluded; ${summary.pending_questions + summary.revise_questions} questions and ${summary.lessons} reading guides to review.` + (changed ? ` ${changed} changed since the previous version.` : '');
    const table = node('table'), head = node('tr'); for (const title of ['Member', 'Questions', 'Reading guides']) head.append(node('th', title)); table.append(head);
    for (const member of DSAReviewData.members) { const count = ReviewAssignments.counts(DSAReviewData, member), row = node('tr'); for (const value of [member, count.question, count.lesson]) row.append(node('td', String(value))); table.append(row); }
    $('team-summary').append(table);
    reconcileWorkspace(); if (db.reviewer) { active = workspace().position; $('type').value = loaded[active]?.kind || 'lesson'; render(); }
  } catch (error) { message('Could not load bundled DSA content: ' + error.message); }
}
const bundledReady = loadBundled();
$('reviewer').onchange = async () => { await openWorkspace(); if (matchMedia('(max-width:760px)').matches) $('item').scrollIntoView({block: 'start'}); };
async function openWorkspace() {
  await bundledReady; const name = $('reviewer').value.trim(); if (!name) { message('Choose your name.'); return; }
  db.reviewer = name; if (!Object.hasOwn(db.people, name)) Object.defineProperty(db.people, name, {value: {states: {}, position: ''}, enumerable: true, writable: true, configurable: true});
  $('assignment-scope').value = 'mine'; reconcileWorkspace(); active = workspace().position; $('topic').value = ''; $('filter').value = 'all'; $('search').value = ''; $('type').value = loaded[active]?.kind || 'lesson';
  session = new Set(); undo = null; $('undo').hidden = true; lastRows = []; save(); render();
}
$('files').onchange = e => loadFiles(e.target.files); $('drop').ondragover = e => e.preventDefault(); $('drop').ondrop = e => { e.preventDefault(); loadFiles(e.dataTransfer.files); };
$('export').onclick = () => { if (!nameRequired()) return; download({format: 'course-review-package', version: 1, reviewer: db.reviewer, exported_at: new Date().toISOString(), position: workspace().position, items: Object.entries(workspace().states).filter(([, s]) => s.fingerprint).map(([k, s]) => ({item_type: k.split(':')[0], id: k.slice(k.indexOf(':') + 1), state: s}))}, `review-${db.reviewer.replace(/[^\p{L}\p{N}_-]/gu, '_')}.json`); };
$('decisions').onclick = () => { if (!nameRequired()) return; download(C.decisions(db.reviewer, workspace().states, Object.fromEntries(eligible())), 'decisions.json'); };
$('import').onchange = async e => {
  try {
    await bundledReady; const p = C.validatePackage(JSON.parse(await e.target.files[0].text())); const existing = db.people[p.reviewer]?.states || {};
    const conflicts = p.items.filter(i => existing[C.key(i.item_type, i.id)] && JSON.stringify(existing[C.key(i.item_type, i.id)]) !== JSON.stringify(i.state));
    if (conflicts.length) throw Error(`Conflicting saved reviews: ${conflicts.map(i => i.id).join(', ')}. Export the local workspace first; use another browser profile to inspect this package separately.`);
    db.reviewer = p.reviewer; if (!Object.hasOwn(db.people, p.reviewer)) Object.defineProperty(db.people, p.reviewer, {value: {states: {}, position: p.position || ''}, enumerable: true, writable: true, configurable: true});
    let staleCount = 0, resetCount = 0;
    for (const i of p.items) {
      const k = C.key(i.item_type, i.id), s = structuredClone(i.state);
      workspace().states[k] = s;
      const outcome = reconcileRecordState(k, loaded[k]);
      if (outcome === 'sources') staleCount++;
      else if (outcome === 'content') resetCount++;
    }
    selectReviewer(p.reviewer); active = workspace().position; session = new Set(); undo = null; save(); render();
    const extra = staleCount ? ` ${staleCount} item(s) retained prior decisions for source recheck.` : '';
    const resetNote = resetCount ? ` ${resetCount} item(s) had content changes (notes retained, verification reset).` : '';
    message(`Package restored.${extra}${resetNote} Assigned DSA content is ready; load matching files only for additional content.`);
  } catch (err) { message(`Import failed: ${err.message}`); } finally { e.target.value = ''; }
};
for (const id of ['type', 'topic', 'filter', 'extras', 'assignment-scope']) $(id).onchange = () => render();
let searchTimer = 0;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
$('search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); if ($('search').value) { $('search').value = ''; render(); } else $('search').blur(); } if (e.key === 'Enter' && lastRows[0]) { e.preventDefault(); open(lastRows[0], {focus: true}); } });
$('clear-filters').onclick = () => { if (nameRequired()) clearFilters(); };
$('undo').onclick = () => {
  if (!undo || undo.reviewer !== db.reviewer) { $('undo').hidden = true; return; }
  workspace().states[undo.key] = undo.state; session.delete(undo.key); active = undo.key; undo = null;
  save(); render(); message('Decision undone. The item is back to how it was.'); $('undo').hidden = true;
};
// Refresh topic choices after file loads without changing the selected topic.
const originalRender = render;
render = function () { const previous = $('topic').value; const topics = [...new Set(eligible().flatMap(([, i]) => [i.record.topic_id, ...(i.record.topic_ids || [])]).filter(Boolean))].sort(); $('topic').replaceChildren(new Option('All topics', ''), ...topics.map(t => new Option(t, t))); $('topic').value = topics.includes(previous) ? previous : ''; originalRender(); };
selectReviewer(db.reviewer || ''); $('assignment-scope').value = workspace()?.scope || 'mine';
if (db.reviewer) { active = workspace()?.position || ''; if (storageBroken) $('saved').textContent = 'Not saved—export a backup'; else $('saved').textContent = 'Restored'; render(); }

// ------------------------------------------------------------------ view options, shortcuts, theme
$('text-smaller').onclick = () => { prefs.scale -= 0.05; applyPrefs(); savePrefs(); };
$('text-larger').onclick = () => { prefs.scale += 0.05; applyPrefs(); savePrefs(); };
$('show-tex').onchange = () => { prefs.showTex = $('show-tex').checked; applyPrefs(); savePrefs(); };
$('focus-mode').onchange = () => { prefs.focus = $('focus-mode').checked; applyPrefs(); savePrefs(); };
$('shortcuts-open').onclick = () => $('shortcuts').showModal();
// The View menu behaves like a menu: a click elsewhere or Escape closes it.
document.addEventListener('click', e => { if ($('view-menu').open && !$('view-menu').contains(e.target)) $('view-menu').open = false; });
$('view-menu').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('view-menu').open = false; $('view-menu').querySelector('summary').focus(); } });
function toggleFlag() { const f = $('flag'); if (!f) return; f.checked = !f.checked; f.dispatchEvent(new Event('change')); message(f.checked ? 'Flagged.' : 'Flag cleared.'); }
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

// Audit overview does not edit reviewer state.
{
 const data = globalThis.DSAReviewData?.audit_overlay, overview = $('audit-overview-content');
 if (data && overview) {
  overview.append(node('p', `${data.total_questions_with_findings} questions have findings; ${Object.keys(data.issues).length} are in the review queue. Choose Questions, Whole team, then Audit findings to see them all.`));
  for (const entry of data.outside_queue || []) {
   const item = node('section'); item.append(node('strong', `${entry.question_id} · previously ${entry.status}, outside this queue`));
   for (const reason of entry.reasons) item.append(rich(reason));
   overview.append(item);
  }
 }
}
