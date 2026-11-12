/* Safe DOM rendering shared by lessons, questions, explanations, and tables. */
'use strict';
const ReviewRender = (() => {
  const el = (tag,text) => {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  function math(parent,formula,display=false,source=formula){
    const span=el('span');span.className='learning-math'+(display?' math-block':'');if(display)span.tabIndex=0;
    try{
      if(!globalThis.katex||formula.length>5000)throw Error('Math renderer unavailable or expression too long');
      katex.render(formula,span,{displayMode:display,output:'htmlAndMathml',throwOnError:true,trust:false,strict:'ignore',maxExpand:1000,maxSize:10});
    }catch(error){span.className='math-fallback';span.textContent=source;span.title='Formula could not be rendered; original source is shown.';}
    parent.append(span);return span;
  }
  function code(parent,text,language=''){
    const pre=el('pre'),content=el('code',text);pre.tabIndex=0;pre.setAttribute('aria-label','Code sample or original source');if(language)content.dataset.language=language;
    pre.append(content);parent.append(pre);return pre;
  }
  function plain(parent,text){
    // Some complexity table cells contain bare Greek/TeX symbols without delimiters.
    const bare=/\\(?:alpha|beta|gamma|delta|theta|Theta|Omega|omega|infty|leq|geq|neq|cdot|times|bmod|log|sum)(?![A-Za-z])/g;
    let cursor=0;
    for(const token of text.matchAll(bare)){parent.append(document.createTextNode(text.slice(cursor,token.index)));math(parent,token[0]);cursor=token.index+token[0].length;}
    parent.append(document.createTextNode(text.slice(cursor)));
  }
  function inline(parent,value){
    const text=String(value??'');
    // Code is consumed first. Math syntax inside code remains literal.
    const tokens=/```[\s\S]*?```|`[^`\r\n]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?![\s$])(?:\\.|[^\\$\r\n])*?(?<!\s)\$(?!\d)|\*\*[^*]+\*\*/g;
    let cursor=0;
    for(const token of text.matchAll(tokens)){
      plain(parent,text.slice(cursor,token.index));const raw=token[0];
      if(raw.startsWith('```')){const body=raw.slice(3,-3).replace(/^[\w+#-]*\r?\n/,'');code(parent,body);}
      else if(raw.startsWith('`'))parent.append(el('code',raw.slice(1,-1)));
      else if(raw.startsWith('**')){const strong=el('strong');inline(strong,raw.slice(2,-2));parent.append(strong);}
      else{const display=raw.startsWith('$$')||raw.startsWith('\\['),delimiter=raw.startsWith('$')&&!display?1:2;math(parent,raw.slice(delimiter,-delimiter),display,raw);}
      cursor=token.index+raw.length;
    }
    plain(parent,text.slice(cursor));
  }
  function prose(parent,text){
    const chunks=String(text??'').split(/(```[\s\S]*?```)/g);
    for(const chunk of chunks){
      if(!chunk)continue;
      if(chunk.startsWith('```')){code(parent,chunk.slice(3,-3).replace(/^[\w+#-]*\r?\n/,''));continue;}
      for(const paragraph of chunk.split(/\n\s*\n/)){
        if(!paragraph.trim())continue;
        const heading=paragraph.match(/^#{1,6}\s+([^\n]+)$/);
        if(heading){const h=el('h4');inline(h,heading[1]);parent.append(h);continue;}
        const lines=paragraph.split('\n');
        if(lines.every(line=>/^\s*[-*]\s+/.test(line))){const ul=el('ul');for(const line of lines){const li=el('li');inline(li,line.replace(/^\s*[-*]\s+/,''));ul.append(li);}parent.append(ul);}
        else{const p=el('div');p.className='prose-paragraph';inline(p,paragraph);parent.append(p);}
      }
    }
    return parent;
  }
  function table(parent,rows){
    if(!rows.length)return;
    const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))],wrap=el('div'),grid=el('table'),header=el('tr');wrap.className='table-wrap';wrap.tabIndex=0;wrap.setAttribute('aria-label','Scrollable data table');
    for(const field of fields){const th=el('th',field.replaceAll('_',' '));th.scope='col';header.append(th);}grid.append(header);
    for(const row of rows){const tr=el('tr');for(const field of fields){const td=el('td'),value=row[field];
      if(value&&typeof value==='object')td.textContent=JSON.stringify(value);
      else if(/bound|complexity/.test(field)&&/\\[A-Za-z]/.test(String(value)))math(td,String(value));
      else inline(td,String(value??''));tr.append(td);
    }grid.append(tr);}wrap.append(grid);parent.append(wrap);
  }
  function block(parent,block){
    const section=el('section');section.className='block'+(block.variant?' callout-'+block.variant:'');const heading=el('h3');inline(heading,block.title||block.caption||block.id);section.append(heading);
    if(block.body_md)prose(section,block.body_md);if(block.description)prose(section,block.description);if(block.source)code(section,block.source,block.language||'cpp');
    if(block.prompt){section.append(el('h4','Checkpoint'));prose(section,block.prompt);}if(block.reveal_md){section.append(el('h4','Answer'));prose(section,block.reveal_md);}
    if(Array.isArray(block.rows))table(section,block.rows);
    for(const [index,step]of(block.steps||[]).entries()){const item=el('section');item.className='trace-step';item.append(el('h4',`Step ${index+1}${step.decision?': '+step.decision:''}`));if(step.explanation)prose(item,step.explanation);if(step.active_index!==undefined)item.append(el('p',`Active index: ${step.active_index}`));if(Array.isArray(step.slots))table(item,step.slots);if(Array.isArray(step.nodes))table(item,step.nodes);section.append(item);}
    const metadata=el('details');metadata.className='block-metadata';metadata.append(el('summary','View original block data'));code(metadata,JSON.stringify(block,null,2));section.append(metadata);parent.append(section);return section;
  }
  return {block,prose,inline,math,table,code};
})();
