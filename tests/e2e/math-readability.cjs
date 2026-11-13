/* Real local-browser math, safety, readability, and full snapshot regression. */
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[],failed=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../../review.html')).href);
  await page.locator('#reviewer').selectOption('Cường');await page.locator('#progress').filter({hasText:/^Cường · /}).waitFor();
  const all=await page.evaluate(()=>{
    let formulas=0;const failures=[];
    for(const record of DSAReviewData.records){const host=document.createElement('div');
      if(record.lesson_id)for(const b of record.blocks)ReviewRender.block(host,b);
      else for(const text of [record.stem,...record.options.map(o=>o.text),record.answer_explanation,...Object.values(record.distractor_explanations)])ReviewRender.prose(host,text);
      formulas+=host.querySelectorAll('.katex').length;
      for(const failure of host.querySelectorAll('.math-fallback'))failures.push({id:record.lesson_id||record.question_id,source:failure.textContent});
    }return{formulas,failures};
  });
  assert.ok(all.formulas>100);assert.deepEqual(all.failures,[]);
  const tokens=await page.evaluate(()=>{
    const host=document.createElement('section');host.id='render-probe';host.style.maxWidth='100%';
    ReviewRender.prose(host,String.raw`Inline $n^2$, display $$\frac{1}{2}$$, brackets \[\sum_{i=1}^{n}i\] and parens \(\alpha+\beta\).`);
    ReviewRender.prose(host,'`$literal$`\n\n```cpp\nconst char* s = "$n^2$";\n```');
    ReviewRender.prose(host,String.raw`Bad $\notARealCommand$ <img src=x onerror=alert(1)> $\href{https://example.com}{click}$`);
    ReviewRender.table(host,[{average_bound:String.raw`O(1/(1-\alpha))`}]);document.body.append(host);
    return{math:host.querySelectorAll('.katex').length,display:host.querySelectorAll('.math-block').length,codeMath:host.querySelectorAll('code .katex,pre .katex').length,fallback:host.querySelectorAll('.math-fallback').length,unsafe:host.querySelectorAll('a,img,script').length,accessible:host.querySelectorAll('.katex-mathml math').length};
  });
  assert.ok(tokens.math>=5);assert.ok(tokens.display>=2);assert.equal(tokens.codeMath,0);assert.equal(tokens.unsafe,0);assert.ok(tokens.fallback>=1);assert.ok(tokens.accessible>=5);
  assert.equal(await page.evaluate(async()=>{await document.fonts.load('16px KaTeX_Main');await document.fonts.ready;return document.fonts.check('16px KaTeX_Main');}),true);
  await page.evaluate(()=>document.getElementById('render-probe').remove());
  // Explicit rendered-math checks for both question text and option/explanation fields.
  await page.evaluate(()=>{const key=Object.keys(loaded).find(k=>k.startsWith('question:')&&ReviewAssignments.belongs(DSAReviewData,loaded[k],'Cường'));const r=loaded[key].record;r.stem=String.raw`Question: $\Theta(n^2)$`;r.options[0].text=String.raw`Option: $\frac{n}{2}$`;r.answer_explanation=String.raw`Explanation: \(n\log n\)`;});
  await page.locator('#type').selectOption('question');assert.ok(await page.locator('.question-stem .katex').count());assert.ok(await page.locator('.answer-options .katex').count());assert.ok(await page.locator('.explanation .katex').count());
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'review-math-ui-'));
  await page.screenshot({path:path.join(output,'question-desktop-light.png'),fullPage:true});
  await page.locator('#type').selectOption('lesson');await page.screenshot({path:path.join(output,'lesson-desktop-light.png'),fullPage:true});
  await page.locator('#view-menu summary').click();await page.locator('#theme').click();await page.locator('#view-menu summary').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.screenshot({path:path.join(output,'lesson-desktop-dark.png'),fullPage:true});
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.locator('#progress').filter({hasText:/^Cường · /}).waitFor();
  await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'lesson-mobile.png'),fullPage:true});
  await page.locator('#view-menu summary').click();await page.locator('#theme').click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,sizes:[...document.querySelectorAll('html,body,.app-header,.app-layout,.sidebar,#item,.review-content,.review-panel,.block,.sources,.content-navigation')].map(e=>({c:e.className,w:e.clientWidth,s:e.scrollWidth,r:e.getBoundingClientRect().right})),elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:String(e.className),right:e.getBoundingClientRect().right,parent:e.parentElement.className,overflow:getComputedStyle(e.parentElement).overflow})).slice(0,20)}));assert.ok(overflow.scroll<=overflow.width,JSON.stringify(overflow));
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(network,[]);
  console.log(`PASS: ${all.formulas} real DSA formulas; all delimiters; question/options/explanations/tables; literal code; safe invalid math/HTML; local fonts; light/dark persistence; 375px and 200% text; zero network or failed asset requests.`);
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
