const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.AUDIT_APP_URL || 'http://127.0.0.1:5681';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
(async () => {
 const b = await chromium.launch({ headless:true, args:['--no-sandbox'] });
 const checks=[]; const check=(name,ok)=>{ assert.ok(ok,name);checks.push({name,passed:true}); };
 try {
  const c=await b.newContext({viewport:{width:390,height:844},storageState:process.env.AUDIT_STORAGE_STATE});
  await c.route('**/*',r=>!['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)&&!['GET','HEAD','OPTIONS'].includes(r.request().method())?r.abort():r.continue());
  const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/');
  await p.getByText('What do you need right now?',{exact:true}).waitFor();
  check('promotions are initially collapsed',await p.getByText('PASS IT ON',{exact:true}).count()===0);
  await p.getByRole('button',{name:'More ways to get help',exact:true}).click();
  check('additional immediate needs remain reachable',await p.getByText('We need to find treatment',{exact:true}).isVisible());
  const connect=p.getByRole('button',{name:'Free Monday call & connection · Show',exact:true});await connect.click();
  check('connection disclosure exposes free call and sharing',await p.getByText('Share the free Monday call',{exact:true}).isVisible());
  await p.getByRole('button',{name:'Free Monday call & connection · Hide',exact:true}).click();
  check('connection can collapse without leaving Today',await p.getByRole('button',{name:'Free Monday call & connection · Show',exact:true}).getAttribute('aria-expanded')==='false');
  await p.screenshot({path:'/tmp/sh-audit-browser/after-today.png'});
  await p.goto(base+'/learn');
  await p.getByRole('button',{name:'Find treatment · free directory →',exact:true}).click();
  await p.waitForURL(base+'/finder');check('Tools treatment entry opens finder',true);
  await p.goto(base+'/learn');await p.getByRole('button',{name:'Talk to someone · Support →',exact:true}).click();
  await p.waitForURL(base+'/support');await p.getByText('TALK TO SOMEONE',{exact:true}).waitFor();
  check('Support clarifies paid versus emergency help',(await p.locator('body').innerText()).includes('Paid coaching is separate and is not emergency care.'));
  await p.screenshot({path:'/tmp/sh-audit-browser/after-support.png'});
  await p.goto(base+'/boundaries');await p.getByText(/Castle walls means agreed boundaries/).waitFor();check('boundaries metaphor explained',true);
  check('no uncaught browser errors',errors.length===0);
  fs.writeFileSync('/tmp/sh-audit-browser/ux-results.json',JSON.stringify(checks,null,2));console.log(JSON.stringify({passed:checks.length,errors}));
 } finally {await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
