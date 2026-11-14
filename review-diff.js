/* Field-level and word-level differences between two versions of a record. Pure functions; no DOM. */
(function (root) {
  'use strict';
  // Fields that describe review state rather than content are never shown as content changes.
  const IGNORED = /^(version|revision|human_review_status|approved_by|approved_at|reviewer_comment|agent_check_status|provenance\.(human_review_status|approved_by|approved_at|version))$/;
  const SOURCE_FIELD = /^reference_sources(?:\[\d+\])?$/;

  function flatten(value, path = '', out = {}) {
    if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
    else out[path] = value;
    return out;
  }

  // Human label for a path such as blocks[3].rows[1].worst_bound, using block ids/types and option ids.
  function label(record, path) {
    let text = path, block;
    const b = path.match(/^blocks\[(\d+)\]/);
    if (b && Array.isArray(record?.blocks) && (block = record.blocks[Number(b[1])])) text = text.replace(b[0], `block ${block.id || block.type || b[1]}`);
    const o = path.match(/^options\[(\d+)\]\.text$/);
    if (o && Array.isArray(record?.options) && record.options[Number(o[1])]) return `option ${record.options[Number(o[1])].option_id}`;
    return text.replace(/^distractor_explanations\.(\w+)$/, 'why $1 is wrong').replace(/\[(\d+)\]/g, ' $1').replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function diffRecords(before, after) {
    const a = flatten(before), b = flatten(after), fields = [];
    for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (IGNORED.test(path) || a[path] === b[path]) continue;
      fields.push({path, label: label(after, path), before: a[path] ?? null, after: b[path] ?? null});
    }
    return fields;
  }

  const TOKEN = /\s+|\\[A-Za-z]+|[A-Za-z0-9]+|[^\sA-Za-z0-9]/g;
  // Longest-common-subsequence diff over tokens; falls back to whole replacement for very long fields.
  function words(before, after) {
    const x = String(before ?? '').match(TOKEN) || [], y = String(after ?? '').match(TOKEN) || [];
    if (x.length * y.length > 4_000_000) return [{op: 'del', text: x.join('')}, {op: 'ins', text: y.join('')}];
    const n = x.length, m = y.length, dp = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [], push = (op, text) => { const last = out[out.length - 1]; if (last && last.op === op) last.text += text; else out.push({op, text}); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++]);
      else push('ins', y[j++]);
    }
    while (i < n) push('del', x[i++]);
    while (j < m) push('ins', y[j++]);
    return out;
  }

  function isSourceField(path) { return SOURCE_FIELD.test(path); }

  function isSourceOnlyChange(before, after) {
    const fields = diffRecords(before, after);
    return fields.length > 0 && fields.every(f => SOURCE_FIELD.test(f.path));
  }

  function stripSourcesAndIgnored(value, prefix = '') {
    if (Array.isArray(value)) return value.map((v, i) => stripSourcesAndIgnored(v, `${prefix}[${i}]`));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (SOURCE_FIELD.test(path) || IGNORED.test(path)) continue;
        out[k] = stripSourcesAndIgnored(v, path);
      }
      return out;
    }
    return value;
  }

  root.ReviewDiff = {flatten, label, diffRecords, words, isSourceField, isSourceOnlyChange, stripSourcesAndIgnored};
  if (typeof module !== 'undefined') module.exports = root.ReviewDiff;
})(globalThis);
