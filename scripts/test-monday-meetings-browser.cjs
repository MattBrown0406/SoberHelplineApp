// Export with fixture Supabase URL/key; serve with SPA fallback at localhost:4399.
// All non-local traffic is intercepted. No real questions or pushes are sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
let debugPage;
(async()=>{
 const browser=await chromium.launch(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {});const context=await browser.newContext({viewport:{width:390,height:844}});
 const id='00000000-0000-4000-8000-000000000099',sessionId='00000000-0000-4000-8000-000000000098';
 const user={id,aud:'authenticated',role:'authenticated',email:'matt@soberhelpline.com',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{},app_metadata:{provider:'email'}};
 const exp=Math.floor(Date.now()/1000)+3600,encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const session={access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,role:'authenticated',aud:'authenticated',exp})+'.fixture',token_type:'bearer',refresh_token:'local-fixture',expires_in:3600,expires_at:exp,user};
 await context.addInitScript(({session,id})=>{localStorage.setItem('sb-app-auth-auth-token',JSON.stringify(session));localStorage.setItem('@sh:onboarded:'+id,'1');},{session,id});
 const questions=[],submissions=[];let failFirst=true;
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
 if(u.origin==='http://127.0.0.1:4399')return route.continue();
 if(u.host!=='app-auth.fixture.invalid')return route.abort();
 if(u.pathname==='/auth/v1/user')return route.fulfill({json:user});
 const rpc=u.pathname.split('/rpc/')[1],body=req.postDataJSON();
 if(rpc==='submit_session_question'){
 submissions.push(body);if(failFirst){failFirst=false;return route.fulfill({status:503,json:{message:'test connection failure'}});}
 if(!questions.length)questions.push({id:body.p_id,question:body.p_question,first_name:'Fixture',last_name:'Family',submitted_at:new Date().toISOString(),crisis_tier:null,session_title:'The Family Squares',read_anonymously:body.p_read_anonymously,meeting_date:'2026-11-30',answered_at:null});
 return route.fulfill({json:{id:body.p_id,crisis_tier:null,meeting_date:'2026-11-30'}});
 }
 if(rpc==='admin_get_session_questions')return route.fulfill({json:questions});
 if(rpc==='admin_answer_session_question'){questions[0].answered_at=body.p_answered?new Date().toISOString():null;return route.fulfill({json:null});}
 if(rpc==='my_account_id')return route.fulfill({json:id});
 if(rpc==='admin_monday_meeting')return route.fulfill({json:{topic:'',takeaway:'',welcome_url:'',zoom_uuid:'',reminders_enabled:false}});
 if(rpc==='admin_monday_attendance')return route.fulfill({json:[]});
 if(rpc)return route.fulfill({json:null});
 if(u.pathname==='/rest/v1/accounts'&&req.method()==='GET')return route.fulfill({json:{id,type:'direct',org_id:null,first_name:'Fixture',last_name:'',language:'en',locale:'en',timezone:'America/Los_Angeles',created_at:'2026-01-01T00:00:00Z'}});
 if(u.pathname==='/rest/v1/sessions'&&req.method()==='GET')return route.fulfill({json:[{id:sessionId,kind:'family',title:'The Family Squares',schedule_label:'Monday 7 PM Pacific',next_at:'2026-12-01T03:00:00Z',zoom_url:'https://zoom.us/j/123456789'}]});
 return route.fulfill({json:req.method()==='GET'?[]:null});
 });
 const page=await context.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4399/support');
 await page.getByRole('button',{name:'Ask a question for Family Squares',exact:true}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Ask a question for Family Squares',exact:true}).click();
 await page.getByPlaceholder('What would you like answered on the call?').fill('How can I set a boundary with kindness?');
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await page.getByRole('button',{name:'Try sending again',exact:true}).waitFor();
 await page.getByRole('button',{name:'Try sending again',exact:true}).click();
 await page.getByText('Your question is saved in the host’s answer queue. You can close this window.',{exact:true}).waitFor();
 assert.equal(submissions.length,2);assert.equal(submissions[0].p_id,submissions[1].p_id);assert.equal(submissions[1].p_read_anonymously,true);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.goto('http://127.0.0.1:4399/admin');
 await page.getByRole('button',{name:'Mark answered',exact:true}).waitFor({timeout:60000});
 await page.getByText('Read without the member’s name.',{exact:true}).waitFor();
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.screenshot({path:'/tmp/monday-admin-queue.png'});
 await page.getByRole('button',{name:'Mark answered',exact:true}).click();
 await page.getByText('No questions in this list.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Show answered questions',exact:true}).click();
 await page.getByRole('button',{name:'Reopen question',exact:true}).click();
 await page.getByRole('button',{name:'Show needs an answer',exact:true}).click();
 await page.getByRole('button',{name:'Mark answered',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({submissionWithoutRsvp:true,retrySameId:true,anonymousPreference:true,answerAndReopen:true,widths:[320,390,768],errors}));await browser.close();
})().catch(async e=>{console.error(e);if(debugPage){console.error('URL',debugPage.url());console.error(await debugPage.locator('body').innerText());await debugPage.screenshot({path:'/tmp/monday-browser-failure.png'});}process.exit(1)});
