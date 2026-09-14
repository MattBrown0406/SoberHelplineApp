// Full exported Expo web app. Auth/account responses are isolated fixtures;
// only GETs to the real public website directory are permitted externally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.EVIDENCE_DIR || '/tmp/sh-provider-directory';
const rows=JSON.parse(fs.readFileSync(out+'/live-app-directory.json')).providers;
const count=rows.length;
(async()=>{
 const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});
 const id='00000000-0000-4000-8000-000000000099';
 const user={id,aud:'authenticated',role:'authenticated',email:'directory-fixture@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{},app_metadata:{provider:'email'}};
 const exp=Math.floor(Date.now()/1000)+3600;
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const session={access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,role:'authenticated',aud:'authenticated',exp})+'.fixture',token_type:'bearer',refresh_token:'local-only-fixture',expires_in:3600,expires_at:exp,user};
 await context.addInitScript(({session,id})=>{localStorage.setItem('sb-app-auth-auth-token',JSON.stringify(session));localStorage.setItem('@sh:onboarded:'+id,'1');},{session,id});
 let directoryFailure=false;const requests=[];
 await context.route('**/*',async route=>{
  const req=route.request();const u=new URL(req.url());
  if(u.origin==='http://127.0.0.1:4398' && req.method()==='GET')return route.continue();
  if(u.host==='anwqprmpzmcqbkttmxos.supabase.co'&&u.pathname==='/rest/v1/provider_submissions_public'&&req.method()==='GET'){
   assert(!String(req.headers().authorization).includes('fixture'));
   requests.push(u.search);if(directoryFailure)return route.fulfill({status:403,json:{message:'fixture directory error'}});
   return route.continue();
  }
  if(u.host==='app-auth.fixture.invalid'){
   if(u.pathname==='/auth/v1/user')return route.fulfill({json:user});
   if(u.pathname==='/rest/v1/accounts'&&req.method()==='GET')return route.fulfill({json:{id,type:'direct',org_id:null,first_name:'Fixture',last_name:'',language:'en',timezone:'UTC',created_at:'2026-01-01T00:00:00Z'}});
   return route.fulfill({json:req.method()==='GET'?[]:{}});
  }
  return route.abort();
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4398/finder');
 await page.getByRole('button',{name:'Browse all providers',exact:true}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'Browse all providers',exact:true}).click();
 await page.getByText(`${count} listings`,{exact:true}).waitFor();

 const checks=[];
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(size.width,size.scroll);checks.push(size);
 }
 await page.getByRole('textbox',{name:'Search name, city, state or service'}).fill('no matching listing fixture');
 await page.getByText('No providers found. Try selecting "Any state" or removing filters.',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Search name, city, state or service'}).fill('');
 await page.getByText('Edit',{exact:true}).click();
 await page.getByText('Select state',{exact:true}).click();
 await page.getByText('Oregon',{exact:true}).click();
 await page.getByRole('button',{name:'Show matches',exact:true}).click();
 const stateCount=rows.filter(x=>x.location.endsWith(', Oregon')).length;
 await page.getByText(`${stateCount} listings in Oregon`,{exact:true}).waitFor();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('button',{name:'Browse all providers',exact:true}).click();
 await page.getByText(`${count} listings`,{exact:true}).waitFor();
 const target=rows[0];
 await page.getByRole('textbox',{name:'Search name, city, state or service'}).fill(target.name);
 const button=page.getByRole('button',{name:`${target.name}, ${target.location}, ${target.category}`,exact:true}).first();
 await button.click();await page.waitForURL('**/finder/'+target.id);
 await page.getByText(target.name,{exact:true}).last().waitFor();
 assert(page.url().startsWith('http://127.0.0.1:4398/finder/'));
 if(target.about)assert((await page.locator('body').innerText()).includes(target.about));
 await page.getByText('Listed pricing',{exact:false}).waitFor();
 assert.equal(context.pages().length,1);
 // Direct unknown listing is a not-found state, not a website redirect.
 await page.goto('http://127.0.0.1:4398/finder/00000000-0000-4000-8000-000000000000');
 await page.getByText('Provider not found.',{exact:true}).waitFor();
 // Retry a real finder request after an explicitly mocked directory failure.
 directoryFailure=true;await page.goto('http://127.0.0.1:4398/finder');
 await page.getByRole('button',{name:'Browse all providers',exact:true}).click();
 await page.getByText('This provider could not be loaded. Check your connection and try again.',{exact:true}).waitFor();
 directoryFailure=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.getByText(`${count} listings`,{exact:true}).waitFor();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByText('Treatment centers',{exact:true}).click();
 await page.getByText('Residential — 30/60/90 day',{exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Show matches',exact:true}).click();
 const residentialCount=rows.filter(x=>x.category==='Inpatient Treatment').length;
 await page.getByText(`${residentialCount} centers`,{exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('@sh:language','es'));
 await page.goto('http://127.0.0.1:4398/finder');
 await page.getByRole('button',{name:'Ver todos los proveedores',exact:true}).click();
 await page.getByText(`${count} anuncios`,{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Buscar por nombre, ciudad, estado o servicio'}).fill('Desintoxicación');
 await page.getByText('1 anuncios',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/browser.json',JSON.stringify({checks,liveCount:count,nativeDetailId:target.id,noExternalNavigation:true,retry:true,notFound:true,stateFilter:true,emptySearch:true,spanishSearch:true,errors,publicDirectoryRequests:requests.length},null,2));
 console.log(fs.readFileSync(out+'/browser.json','utf8'));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
