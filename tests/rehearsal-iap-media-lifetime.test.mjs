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
  const hook=load('src/hooks/useIAP.ts',{react:h.react,'../contexts/AccountContext':{useAccount:()=>({user:{id:owner}})},'react-native-purchases':{default:sdk},'../lib/revenueCat':rc,'../lib/reviewPrompt':{setReviewPromptPurchaseFlow(){}}}).useIAP;
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
for(const stage of ['purchase','sync','refresh'])test(`support stale ${stage} completion suppresses subsequent effects`,async()=>{
  const gate=deferred(),owner={owner:'A',active:true},calls=[];
  const wait=async(name,result)=>{calls.push(name);if(stage===name)await gate.promise;return result;};
  const fn=extract('app/(tabs)/support.tsx','handlePurchase',{purchaseOwner:owner,purchaseOwnerRef:{current:owner},subscriptionPrices:{premium:'$1'},upgradeTier:'premium',purchasePremium:()=>wait('purchase','success'),purchaseEssential:()=>{},user:{id:'A'},recordVerifiedPurchase(){calls.push('record');},withTimeoutFallback:p=>p,supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'auth-A'},access_token:'token-A'}}})},functions:{invoke:()=>wait('sync',{})}},refreshAccount:()=>wait('refresh'),closeUpgrade(){calls.push('close');},appAlert(){calls.push('alert');},t:x=>x});
  const pending=fn();await settle();owner.active=false;gate.resolve();await pending;
  assert.ok(!calls.includes('close'));if(stage==='purchase')assert.deepEqual(calls,['purchase']);if(stage==='sync')assert.ok(!calls.includes('refresh'));
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
