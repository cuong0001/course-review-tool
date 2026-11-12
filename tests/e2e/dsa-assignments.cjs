const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const A=require('../../review-assignments.js');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  const root=path.resolve(__dirname,'../..'),sandbox={};vm.runInNewContext(fs.readFileSync(path.join(root,'data/dsa-review-data.js'),'utf8'),sandbox);const data=sandbox.DSAReviewData;
  await page.goto(pathToFileURL(path.join(root,'review.html')).href);
  await page.getByText(/229 approved questions excluded/).waitFor();
  assert.deepEqual(await page.locator('#reviewer option').allTextContents(),['Choose your name',...data.members]);
  for(const member of data.members){
   await page.locator('#reviewer').selectOption(member);
   await page.getByText(member+' — your assigned work',{exact:true}).waitFor();
   const counts=A.counts(data,member);
   assert.equal(await page.locator('#queue button').count(),counts.lesson);
   for(const label of await page.locator('#queue button').allTextContents()){const id=label.split(' · ')[0];assert.equal(data.assignments.lesson[id],member);}
   await page.locator('#type').selectOption('question');
   assert.equal(await page.locator('#queue button').count(),counts.question);
   for(const label of await page.locator('#queue button').allTextContents()){const id=label.split(' · ')[0];assert.equal(data.assignments.question[id],member);}
  }
  await page.locator('#reviewer').selectOption('Cường');await page.locator('#type').selectOption('question');
  const first=await page.locator('#item h2').innerText();await page.getByLabel('Overall notes / what should be fixed').fill('Ghi chú của Cường');
  await page.reload();await page.getByText('Cường — your assigned work',{exact:true}).waitFor();await page.locator('#item h2').filter({hasText:first}).waitFor();
  assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(),'Ghi chú của Cường');
  await page.locator('#reviewer').selectOption('Hiếu');assert.equal(await page.getByLabel('Overall notes / what should be fixed').inputValue(),'');
  await page.locator('#assignment-scope').selectOption('all');await page.locator('#type').selectOption('question');assert.equal(await page.locator('#queue button').count(),347);
  await page.locator('#assignment-scope').selectOption('mine');assert.equal(await page.locator('#queue button').count(),58);
  await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'dsa-assignment-browser-'));await page.screenshot({path:path.join(output,'member-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log('PASS: all six DSA assignments load without a file picker, balanced counts, approved exclusions, member isolation, reload recovery, owner overview, 375px; no network requests.');
  console.log('Screenshot: '+path.join(output,'member-mobile.png'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
