import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=ts.createSourceFile('settings.tsx',fs.readFileSync(new URL('../app/settings.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function load(name,env){let node;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit)}visit(source);assert(node);const code=ts.transpileModule(`const action=(${node.getText(source)});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(env),code+'; return action;')(...Object.values(env));}
test('logout cleanup awaits personal then legacy cancellation and reports failures',async()=>{const calls=[];let reject=false;const fn=load('clearRemindersBeforeExit',{user:{id:'a'},cancelPersonalRemindersForLogout:async()=>{calls.push('personal');if(reject)throw Error('OS failure')},cancelPushRegistration:async id=>calls.push(id),appAlert:()=>calls.push('alert'),restoreRemindersAfterAbortedExit:()=>calls.push('restore'),personalReminders:{snapshot:()=>({accountId:'a',items:[]})},remindersBeforeExit:{current:[]},t:x=>x});assert.equal(await fn(),true);assert.deepEqual(calls,['personal','a']);calls.length=0;reject=true;assert.equal(await fn(),false);assert.deepEqual(calls,['personal','restore','alert']);});
test('failed reminder cleanup prevents signout and remote token mutation',async()=>{let touched=false;const fn=load('handleSignOut',{clearRemindersBeforeExit:async()=>false,user:{id:'a'},supabase:{from:()=>{touched=true},auth:{signOut:async()=>{touched=true}}},appAlert(){},t:x=>x});await fn();assert.equal(touched,false);});
test('account deletion waits for cleanup and preserves account on failure',async()=>{let confirm;let deleted=false;const busy=[];const fn=load('handleDeleteAccount',{accountState:'direct-free',user:{id:'a'},purgeAccountLocalData:async()=>{},captureAppError(){},appAlert:(_t,_b,buttons)=>{if(buttons)confirm=buttons[1].onPress},t:x=>x,setDeletingAccount:x=>busy.push(x),clearRemindersBeforeExit:async()=>false,supabase:{rpc:async()=>{deleted=true},auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>{deleted=true}},functions:{invoke:async()=>({error:null})}}});fn();await confirm();assert.equal(deleted,false);assert.deepEqual(busy,[true,false]);});
test('account deletion removes the website account first, then her stored files, then the app account',async()=>{
  const run=async({website,purgeError=null,rpcError=null})=>{
    const calls=[];const alerts=[];let confirm;let restored=0;
    const fn=load('handleDeleteAccount',{accountState:'direct-free',user:{id:'a'},purgeAccountLocalData:async()=>{},captureAppError(){},
      appAlert:(title,body,buttons)=>{if(buttons)confirm=buttons[1].onPress;else alerts.push([title,body])},t:x=>x,setDeletingAccount(){},
      clearRemindersBeforeExit:async()=>true,restoreRemindersAfterAbortedExit:()=>{restored+=1},
      supabase:{rpc:async name=>{calls.push(name);return{error:rpcError}},auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},
        functions:{invoke:async name=>{calls.push(name);return name==='delete-website-account'?website:{error:purgeError}}}}});
    fn();await confirm();return{calls,alerts,restored};
  };
  // The website can't finish: nothing more of hers is touched, and she is told the app account was not.
  let r=await run({website:{data:{ok:false,result:'unreachable'},error:null}});
  assert.deepEqual(r.calls,['delete-website-account']);
  assert.deepEqual(r.alerts,[['deleteAccount.errorTitle','deleteAccount.websiteErrorMessage']]);
  assert.equal(r.restored,1);
  r=await run({website:{data:null,error:new Error('offline')}});
  assert.deepEqual(r.calls,['delete-website-account']);
  // All good: website, then stored files, then the account.
  r=await run({website:{data:{ok:true,result:'deleted'},error:null}});
  assert.deepEqual(r.calls,['delete-website-account','purge-account-files','delete_own_account']);
  assert.deepEqual(r.alerts,[]);
  // A retry after the website account is gone (not_found) carries on the same way.
  r=await run({website:{data:{ok:true,result:'not_found'},error:null}});
  assert.deepEqual(r.calls,['delete-website-account','purge-account-files','delete_own_account']);
  // Files fail after the website account went: the app account stays, and the message says the website part is done.
  r=await run({website:{data:{ok:true,result:'deleted'},error:null},purgeError:new Error('storage')});
  assert.deepEqual(r.calls,['delete-website-account','purge-account-files']);
  assert.deepEqual(r.alerts,[['deleteAccount.errorTitle','deleteAccount.appErrorMessage']]);
  assert.equal(r.restored,1);
  // No website account (not_found): the ordinary message.
  r=await run({website:{data:{ok:true,result:'not_found'},error:null},rpcError:new Error('db')});
  assert.deepEqual(r.alerts,[['deleteAccount.errorTitle','deleteAccount.errorMessage']]);
  // The words stay true in every branch: photos may already be gone, and on a retry the
  // website account may have gone on the earlier try, so no message says "nothing was deleted".
  for(const lang of ['en','es']){
    const copy=JSON.parse(fs.readFileSync(new URL(`../src/locales/${lang}/settings.json`,import.meta.url),'utf8')).deleteAccount;
    for(const key of ['errorMessage','websiteErrorMessage','appErrorMessage'])assert.doesNotMatch(copy[key],/nothing was deleted|no se eliminó nada/i,`${lang}.${key}`);
  }
});
