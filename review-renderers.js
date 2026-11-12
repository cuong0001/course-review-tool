/* Safe DOM rendering: dataset strings never become HTML. */
'use strict';
const ReviewRender = (() => {
  function el(tag, text) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function inline(parent, text) {
    // A small readable subset, with unsupported math kept verbatim.
    for (const token of String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
      if (token.startsWith('`') && token.endsWith('`')) parent.append(el('code', token.slice(1, -1)));
      else if (token.startsWith('**') && token.endsWith('**')) parent.append(el('strong', token.slice(2, -2)));
      else parent.append(document.createTextNode(token));
    }
  }

  function prose(parent, text) {
    let fenced = false, code = [];
    for (const line of String(text).split('\n')) {
      if (line.trim().startsWith('```')) {
        if (fenced) { parent.append(el('pre', code.join('\n'))); code = []; }
        fenced = !fenced;
      } else if (fenced) code.push(line);
      else if (line.trim()) {
        const heading = line.match(/^#{1,6}\s+(.*)/);
        const paragraph = el(heading ? 'h4' : 'p');
        inline(paragraph, heading ? heading[1] : line);
        parent.append(paragraph);
      }
    }
    if (code.length) parent.append(el('pre', code.join('\n')));
  }

  function table(parent, rows) {
    if (!rows.length) return;
    const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const wrap = el('div'); wrap.className = 'table-wrap';
    const grid = el('table'), header = el('tr');
    fields.forEach(field => { const th = el('th', field.replaceAll('_', ' ')); th.scope = 'col'; header.append(th); });
    grid.append(header);
    for (const row of rows) {
      const tr = el('tr');
      fields.forEach(field => tr.append(el('td', typeof row[field] === 'object' ? JSON.stringify(row[field]) : String(row[field] ?? ''))));
      grid.append(tr);
    }
    wrap.append(grid); parent.append(wrap);
  }

  function block(parent, block) {
    const section = el('section'); section.className = 'block';
    section.append(el('h3', block.title || block.caption || block.id));
    if (block.body_md) prose(section, block.body_md);
    if (block.description) prose(section, block.description);
    if (block.source) section.append(el('pre', block.source));
    if (block.prompt) { section.append(el('h4', 'Checkpoint')); prose(section, block.prompt); }
    if (block.reveal_md) { section.append(el('h4', 'Answer')); prose(section, block.reveal_md); }
    if (Array.isArray(block.rows)) table(section, block.rows);
    for (const [index, step] of (block.steps || []).entries()) {
      const stepSection = el('section');
      stepSection.append(el('h4', `Step ${index + 1}${step.decision ? ': ' + step.decision : ''}`));
      if (step.explanation) prose(stepSection, step.explanation);
      if (step.active_index !== undefined) stepSection.append(el('p', `Active index: ${step.active_index}`));
      if (Array.isArray(step.slots)) table(stepSection, step.slots);
      if (Array.isArray(step.nodes)) table(stepSection, step.nodes);
      section.append(stepSection);
    }
    // Preserve every field for verification without making the reading flow a JSON dump.
    const metadata = el('details'); metadata.append(el('summary', 'Full block data / metadata'), el('pre', JSON.stringify(block, null, 2)));
    section.append(metadata); parent.append(section);
    return section;
  }
  return {block, prose};
})();
