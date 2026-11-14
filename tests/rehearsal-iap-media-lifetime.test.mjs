import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Real source execution with deterministic hook/SDK doubles; not native rendering.
const root = path.resolve(import.meta.dirname, '..');
const source = p => process.env.AUDIT_BASELINE_REF
  ? execFileSync('git', ['show', `${process.env.AUDIT_BASELINE_REF}:${p}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, p), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const settle = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
function harness() {
  const slots=[], effects=[]; let i=0;
  return {
    react: {
      useState(x) { const j=i++; if (!(j in slots)) slots[j]=typeof x==='function'?x():x; return [slots[j],v=>{slots[j]=typeof v==='function'?v(slots[j]):v;}]; },
      useRef(x) { return slots[i++] ??= {current:x}; },
      useCallback(f) {i++; return f;},
      useEffect(f,deps) { const j=i++; const old=slots[j]; if (!old || deps.some((x,k)=>x!==old.deps[k])) {effects.push(()=>{old?.cleanup?.();slots[j]={deps,cleanup:f()};});} },
    },
    render(f) {i=0;const result=f();effects.splice(0).forEach(f=>f());return result;},
    unmount() {slots.forEach(s=>s?.cleanup?.());},
  };
}
function load(p,mocks,extras={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:id=>{assert.ok(id in mocks,`missing mock ${id}`);return mocks[id];},console,setTimeout,clearTimeout,...extras});
  return module.exports;
}
function extract(p,name,scope) {
  const text=source(p),ast=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let code;
  function visit(n) {
    if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name) code=`const extracted = ${n.initializer.getText(ast)}`;
    if(ts.isFunctionDeclaration(n)&&n.name?.text===name) code=`const extracted = ${n.getText(ast)}`;
    ts.forEachChild(n,visit);
  }
  visit(ast);assert.ok(code,`missing ${name}`);
  return vm.runInNewContext(ts.transpile(code+';\nextracted;', {target:ts.ScriptTarget.ES2022}),{useCallback:f=>f,...scope});
}
function rehearsal(invoke,timer=setTimeout) {
  const h=harness();let id='A',account='account-A',listener;
  const session=()=>({user:{id},access_token:`token-${id}`,refresh_token:`refresh-${id}`});
  const auth={getSession:async()=>({data:{session:session()}}),onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe(){listener=null;}}}};},refreshSession:async()=>({data:{session:session()}})};
  const hook=load('src/hooks/useRehearsalPartner.ts',{
    react:h.react,'../contexts/AccountContext':{useAccount:()=>({user:{id:account}})},
    '../lib/supabase':{supabase:{auth,functions:{invoke}}},
    '../lib/practiceSafety':{isStale:(a,b)=>a!==b,keepPracticingFrom:()=>null},
  },{setTimeout:timer}).useRehearsalPartner;
  const render=()=>h.render(()=>hook({temperament:'guarded',name:'private A loved one'}));
  return {render,h,auth,switchAuth(next){id=next;listener?.('SIGNED_IN',session());},switchAccount(){account='account-B';render();}};
}
for(const invalidation of ['unmount','auth','account']) test(`rehearsal ${invalidation} blocks delayed retry and retained audio callback`,async()=>{
  const retry=deferred(),calls=[];
  const r=rehearsal(async(_,options)=>{calls.push(options);return {data:null,error:Error('network')};},fn=>retry.promise.then(fn));
  const api=r.render();await settle();const pending=api.send('private A transcript');await settle();
  assert.equal(calls.length,1);
  if(invalidation==='unmount')r.h.unmount();else if(invalidation==='auth')r.switchAuth('B');else r.switchAccount();
  retry.resolve();await pending;await api.transcribeClip('private-audio','m4a');
  assert.equal(calls.length,1);
});
test('rehearsal same-user refresh retries with pinned Authorization',async()=>{
  const calls=[];const r=rehearsal(async(_,opts)=>{calls.push(opts);return calls.length===1?{data:null,error:{context:{clone:()=>({json:async()=>({code:'unauthorized'})})}}}:{data:{ok:true,text:'reply',audio:'voice'},error:null};});
  const api=r.render();await settle();assert.equal((await api.send('hello')).audio,'voice');assert.equal(calls.length,2);assert.equal(calls[1].headers.Authorization,'Bearer token-A');
});
test('rehearsal delayed completion and delayed 401 parsing never refresh B',async()=>{
  const body=deferred();let refreshes=0;
  const r=rehearsal(async()=>({data:null,error:{context:{clone:()=>({json:()=>body.promise})}}}));
  r.auth.refreshSession=async()=>{refreshes++;};const api=r.render();await settle();
  const pending=api.send('private');await settle();r.switchAuth('B');body.resolve({code:'unauthorized'});await pending;assert.equal(refreshes,0);
});
function iap() {
  const h=harness(),price=deferred(),purchases=[];let owner='account-A',rcOwner=owner,reads=0;
  const pkg={product:{identifier:'sh_premium_monthly',priceString:'$1'}};
  const offerings={all:{main:{availablePackages:[pkg]}}};
  const sdk={configure(){},async getAppUserID(){return rcOwner;},async logOut(){rcOwner='$RCAnonymousID:test';},async logIn(id){rcOwner=id;},getOfferings(){return ++reads===1?Promise.resolve(offerings):price.promise;},async purchasePackage(){purchases.push(rcOwner);return {customerInfo:{entitlements:{active:{premium:{}}}}};}};
  const rc=load('src/lib/revenueCat.ts',{'react-native-purchases':{default:sdk},'../config':{RC_API_KEY:'public-test'}});
  const hook=load('src/hooks/useIAP.ts',{react:h.react,'../contexts/AccountContext':{useAccount:()=>({user:{id:owner}})},'react-native-purchases':{default:sdk},'../lib/revenueCat':rc,'../lib/reviewPrompt':{setReviewPromptPurchaseFlow(){}},'../lib/subscriptionTrial':{freeTrialOffer:()=>null},'react-native':{AppState:{addEventListener:()=>({remove(){}})}}}).useIAP;
  const render=()=>h.render(hook);
  return {h,price,purchases,offerings,render,rc,pkg,sdk,switchAccount(){owner='account-B';render();}};
}
for(const why of ['unmount','account'])test(`IAP ${why} during offerings never buys as B`,async()=>{
  const x=iap(),api=x.render(),pending=api.purchasePremium();await settle();
  if(why==='unmount')x.h.unmount();else x.switchAccount();
  await x.rc.resetRevenueCatUser();await x.rc.configureRevenueCat('account-B');x.price.resolve(x.offerings);
  assert.notEqual(await pending,'success');assert.deepEqual(x.purchases,[]);await api.purchasePremium();assert.deepEqual(x.purchases,[]);
});
test('IAP current owner positive control',async()=>{const x=iap(),api=x.render(),p=api.purchasePremium();x.price.resolve(x.offerings);assert.equal(await p,'success');assert.deepEqual(x.purchases,['account-A']);});
test('RevenueCat queue rechecks expected owner and lifetime inside queued operation',async()=>{
  const x=iap(),gate=deferred();x.sdk.logIn=()=>gate.promise;const login=x.rc.configureRevenueCat('account-B');await settle();let active=true;
  const buying=x.rc.purchaseRevenueCatPackage(x.pkg,'account-A',()=>active);active=false;gate.resolve();await login;
  await assert.rejects(buying);assert.deepEqual(x.purchases,[]);
  const y=iap();await y.rc.configureRevenueCat('account-B');await assert.rejects(y.rc.purchaseRevenueCatPackage(y.pkg,'account-A',()=>true));assert.deepEqual(y.purchases,[]);
});
for(const p of ['app/rehearsal-live.tsx','app/rehearsal-incoming.tsx'])for(const os of ['web','ios'])for(const waitAt of ['mode','create'])test(`${p} ${os}: ${waitAt} completion after teardown never autoplays`,async()=>{
  const gate=deferred(),soundRef={current:null},audioGeneration={current:0},audioActive={current:true},audioBlocked={current:false};let played=0,unloaded=0,creates=0;
  const sound={async unloadAsync(){unloaded++;},async playAsync(){played++;}};
  const scope={Audio:{setAudioModeAsync:()=>waitAt==='mode'?gate.promise:Promise.resolve(),Sound:{createAsync:async(_,opts)=>{creates++;if(opts.shouldPlay)played++;if(waitAt==='create')await gate.promise;return {sound};}}},Platform:{OS:os},FileSystem:{cacheDirectory:'cache/',EncodingType:{Base64:'base64'},writeAsStringAsync:async()=>{}},clipCounter:{current:0},soundRef,audioGeneration,audioActive,audioBlocked};
  const play=extract(p,'playAudio',scope),stop=source(p).includes('const stopAudio =')
    ? extract(p,'stopAudio',scope) : () => { void soundRef.current?.unloadAsync(); };
  const pending=play('audio');await settle();audioActive.current=false;stop();gate.resolve();await pending;
  assert.equal(played,0);assert.equal(creates,waitAt==='create'?1:0);if(creates)assert.equal(unloaded,1);
});
for(const p of ['app/rehearsal-live.tsx','app/rehearsal-incoming.tsx'])test(`${p}: crisis stop unloads existing audio and blocks new playback`,async()=>{
  let stopped=0;const scope={audioGeneration:{current:1},audioActive:{current:true},audioBlocked:{current:false},soundRef:{current:{unloadAsync:async()=>{stopped++;}}}};
  const stop=extract(p,'stopAudio',scope);scope.audioBlocked.current=true;stop();await extract(p,'playAudio',scope)('ignored');assert.equal(stopped,1);assert.equal(scope.soundRef.current,null);
});
for(const kind of ['microphone','camera'])test(`native ${kind}: rejected SDK toggle retains source-of-truth and reports failure; double taps serialized`,async()=>{
  const gate=deferred();let alerts=0,calls=0;const key=kind==='microphone'?'isMicrophoneEnabled':'isCameraEnabled',method=kind==='microphone'?'setMicrophoneEnabled':'setCameraEnabled';
  const participant={[key]:true,[method]:async()=>{calls++;await gate.promise;throw Error('SDK failed');}};
  let ui=true;
  const scope={localParticipant:participant,mediaBusy:{current:false},mediaActive:{current:true},setMediaPending(){},Alert:{alert(){alerts++;}},t:x=>x,micOn:true,cameraOn:true,setMicOn:v=>{ui=v;},setCameraOn:v=>{ui=v;}};
  const modern=source('app/video-session.native.tsx').includes('const toggleMedia =');
  const fn=extract('app/video-session.native.tsx',modern?'toggleMedia':kind==='microphone'?'toggleMic':'toggleCamera',scope);
  const a=fn(kind),b=fn(kind);gate.resolve();await Promise.allSettled([a,b]);assert.equal(ui,true);assert.equal(calls,1);assert.equal(participant[key],true);assert.equal(alerts,1);
});
test('native SDK resolved no-op is reported rather than claiming OFF',async()=>{
  let alerts=0;const fn=extract('app/video-session.native.tsx','toggleMedia',{localParticipant:{isMicrophoneEnabled:true,setMicrophoneEnabled:async()=>{}},mediaBusy:{current:false},mediaActive:{current:true},setMediaPending(){},Alert:{alert(){alerts++;}},t:x=>x});await fn('microphone');assert.equal(alerts,1);
});
// The purchase flow lives in the plans hook (the Support tab only opens the plans screen).
function planPurchase(overrides={}) {
  const owner={owner:'A',active:true,generation:0},calls=[],logged=[],auth={id:'auth-A'};
  const scope={source:'support_tab',logMembershipPath:(step,meta)=>{logged.push([step,meta.tier,meta.source]);},purchaseOwner:owner,purchaseOwnerRef:{current:owner},purchaseFlow:{current:{phase:'idle'}},setFlowPhase(){},subscriptionPrices:{premium:'$1',essential:'$1'},upgradeTier:'premium',purchasePremium:async()=>'success',purchaseEssential:async()=>'success',user:{id:'A'},recordVerifiedPurchase(){calls.push('record');},retryPrices(){},withTimeoutFallback:p=>p,supabase:{auth:{getSession:async()=>({data:{session:{user:{id:auth.id},access_token:'token-A'}}})},functions:{invoke:async()=>{calls.push('sync');return {};}}},refreshAccount:async()=>{calls.push('refresh');},closeUpgrade(){calls.push('close');},appAlert(){calls.push('alert');},t:x=>x,...overrides};
  return {owner,calls,logged,auth,scope,fn:extract('src/hooks/usePlanPurchase.ts','handlePurchase',scope)};
}
// M-A: a purchase the store completes after the screen closed is still hers.
for(const stage of ['purchase','sync','refresh'])test(`plans screen closed during ${stage}: the purchase is still recorded, synced and refreshed; only the sheet is left alone`,async()=>{
  const gate=deferred(),held=[];
  const wait=async(name,result)=>{held.push(name);if(stage===name)await gate.promise;return result;};
  // (Overrides go in at creation: the sandbox copies the top-level scope.)
  const x=planPurchase({purchasePremium:()=>wait('purchase','success'),refreshAccount:async()=>{x.calls.push('refresh');await wait('refresh');}});
  x.scope.supabase.functions.invoke=async()=>{x.calls.push('sync');return wait('sync',{});};
  const pending=x.fn();await settle();assert.equal(x.scope.purchaseFlow.current.phase,stage==='purchase'?'store':'finishing');
  x.owner.active=false;x.owner.generation+=1;gate.resolve();await pending;
  assert.deepEqual(x.calls,['record','sync','refresh']);
  assert.deepEqual(x.logged,[['purchase_started','premium','support_tab'],['purchase_succeeded','premium','support_tab']]);
  assert.equal(x.scope.purchaseFlow.current.phase,'idle');
});
for(const stage of ['purchase','sync'])for(const how of ['account','session'])test(`a different ${how} after ${stage} is never credited with the purchase`,async()=>{
  const gate=deferred();
  const x=planPurchase({purchasePremium:async()=>{if(stage==='purchase')await gate.promise;return 'success';}});
  x.scope.supabase.functions.invoke=async()=>{x.calls.push('sync');if(stage==='sync')await gate.promise;return {};};
  const pending=x.fn();await settle();
  if(how==='account')x.scope.purchaseOwnerRef.current={owner:'B',active:true,generation:0};else x.auth.id='auth-B';
  gate.resolve();await pending;
  assert.ok(!x.calls.includes('close'));assert.ok(!x.calls.includes('refresh'));
  if(stage==='purchase'){assert.deepEqual(x.calls,[]);assert.deepEqual(x.logged,[['purchase_started','premium','support_tab']]);}
  assert.equal(x.scope.purchaseFlow.current.phase,'idle');
});
test('a fast double tap starts one purchase, logs one start and never a false cancel',async()=>{
  const gate=deferred();let purchases=0;
  const x=planPurchase({purchasePremium:async()=>{purchases++;await gate.promise;return 'success';}});
  const first=x.fn(),second=x.fn();await settle();const third=x.fn();
  gate.resolve();await Promise.all([first,second,third]);
  assert.equal(purchases,1);
  assert.deepEqual(x.logged.map(entry=>entry[0]),['purchase_started','purchase_succeeded']);
  assert.deepEqual(x.calls,['record','sync','refresh','close']);
});
test('a purchase that fails after the screen closed is logged but shows no alert there',async()=>{
  const gate=deferred();
  const x=planPurchase({purchasePremium:async()=>{await gate.promise;return 'failed';}});
  const pending=x.fn();await settle();x.owner.active=false;gate.resolve();await pending;
  assert.deepEqual(x.calls,[]);
  assert.deepEqual(x.logged.map(entry=>entry[0]),['purchase_started','purchase_failed']);
});
test('the sheet cannot be closed, nor a second sheet opened, while the App Store has not answered',()=>{
  const calls=[];
  const scope={purchaseFlow:{current:{phase:'store'}},upgradeOpenRef:{current:true},setReviewPromptPaywallVisible:v=>calls.push(['paywall',v]),setUpgradeOpen:v=>calls.push(['open',v]),setUpgradeTier(){},setSheetAttempt(){calls.push(['attempt']);},logMembershipPath(){calls.push(['log']);},source:'support_tab'};
  const close=extract('src/hooks/usePlanPurchase.ts','closeUpgrade',scope),open=extract('src/hooks/usePlanPurchase.ts','openUpgrade',scope);
  close();open('premium');assert.deepEqual(calls,[]);
  scope.purchaseFlow.current.phase='finishing';close();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['paywall',false],['open',false]]);assert.equal(scope.upgradeOpenRef.current,false);
});
test('a plan button always presents the sheet, even when state already says it is open',()=>{
  const calls=[];
  const scope={purchaseFlow:{current:{phase:'idle'}},upgradeOpenRef:{current:false},setReviewPromptPaywallVisible(){},setUpgradeOpen:v=>calls.push(['open',v]),setUpgradeTier:v=>calls.push(['tier',v]),setSheetAttempt:f=>calls.push(['attempt',f(0)]),logMembershipPath(){},source:'support_tab'};
  const open=extract('src/hooks/usePlanPurchase.ts','openUpgrade',scope);
  open('essential');assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['tier','essential'],['open',true]]);
  // iOS dropped the presentation: state still says open, she taps a plan again.
  calls.length=0;open('premium');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['tier','premium'],['attempt',1],['open',true]]);
});
test('IAP: the store answering after the screen closed is still reported as a success',async()=>{
  const x=iap(),gate=deferred();x.sdk.purchasePackage=async()=>{x.purchases.push('account-A');return gate.promise;};
  const api=x.render(),pending=api.purchasePremium();x.price.resolve(x.offerings);await settle();
  assert.deepEqual(x.purchases,['account-A']);
  x.h.unmount();gate.resolve({customerInfo:{entitlements:{active:{premium:{}}}}});
  assert.equal(await pending,'success');
});
test('IAP: a real store failure is a failure, and "never reached the store" is not',async()=>{
  const x=iap();x.sdk.purchasePackage=async()=>{throw Error('store down');};
  const original=console.error;console.error=()=>{};
  try{const api=x.render(),p=api.purchasePremium();x.price.resolve(x.offerings);assert.equal(await p,'failed');}finally{console.error=original;}
  const y=iap();y.sdk.purchasePackage=async()=>{throw Object.assign(Error('no'),{userCancelled:true});};
  const api=y.render(),p=api.purchasePremium();y.price.resolve(y.offerings);assert.equal(await p,'cancelled');
});
for(const [result,step,alerted] of [['success','purchase_succeeded',false],['cancelled','purchase_cancelled',false],['failed','purchase_failed',true]])test(`plan purchase logs ${step} with the tier and source only`,async()=>{
  const logged=[];
  const x=planPurchase({source:'after_meeting',logMembershipPath:(name,meta)=>{logged.push([name,meta]);},subscriptionPrices:{essential:'$1'},upgradeTier:'essential',purchasePremium:()=>{throw Error('wrong tier');},purchaseEssential:async()=>result});
  await x.fn();
  // (Through JSON: the objects were made inside the sandbox.)
  assert.deepEqual(JSON.parse(JSON.stringify(logged)),[['purchase_started',{tier:'essential',source:'after_meeting'}],[step,{tier:'essential',source:'after_meeting'}]]);
  assert.equal(x.calls.includes('alert'),alerted);assert.equal(x.calls.includes('close'),result==='success');
});
test('no store price: nothing is started and nothing is logged',async()=>{
  const x=planPurchase({source:'chat_gate',subscriptionPrices:{},upgradeTier:'essential',purchaseEssential:()=>{throw Error('must not purchase');},purchasePremium:()=>{throw Error('must not purchase');}});
  await x.fn();assert.deepEqual(x.logged,[]);assert.equal(x.scope.purchaseFlow.current.phase,'idle');
});
test('rehearsal initial request waits for session binding; late private result is discarded',async()=>{
  const response=deferred();const r=rehearsal(()=>response.promise);const api=r.render();
  const pending=api.send('private A');await settle();r.switchAuth('B');
  response.resolve({data:{ok:true,text:'private A reply',audio:'private A audio'},error:null});
  assert.equal((await pending).audio,null);assert.equal(r.render().messages.length,0);
});
for(const p of ['app/rehearsal-live.tsx','app/rehearsal-incoming.tsx'])test(`${p}: newest clip wins and valid clip plays once`,async()=>{
  const first=deferred();let creates=0;const sounds=[0,1].map(()=>({played:0,unloaded:0,async playAsync(){this.played++;},async unloadAsync(){this.unloaded++;}}));
  const scope={audioGeneration:{current:0},audioActive:{current:true},audioBlocked:{current:false},soundRef:{current:null},clipCounter:{current:0},Platform:{OS:'web'},Audio:{setAudioModeAsync:async()=>{},Sound:{createAsync:async()=>{const index=creates++;if(index===0)await first.promise;return {sound:sounds[index]};}}}};
  const play=extract(p,'playAudio',scope);const old=play('old');await settle();await play('new');first.resolve();await old;
  assert.equal(sounds[0].played,0);assert.equal(sounds[0].unloaded,1);assert.equal(sounds[1].played,1);assert.equal(scope.soundRef.current,sounds[1]);
});
test('native successful toggle verifies actual SDK change without alert',async()=>{
  let alerts=0;const participant={isMicrophoneEnabled:true,async setMicrophoneEnabled(next){this.isMicrophoneEnabled=next;}};
  const fn=extract('app/video-session.native.tsx','toggleMedia',{localParticipant:participant,mediaBusy:{current:false},mediaActive:{current:true},setMediaPending(){},Alert:{alert(){alerts++;}},t:x=>x});
  await fn('microphone');assert.equal(participant.isMicrophoneEnabled,false);assert.equal(alerts,0);
});
