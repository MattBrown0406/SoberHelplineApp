import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, back, freshPractice, loadPractice, resetPractice, savePractice, storageKey, validate, StalePracticeError, type Storage } from '../src/samplePractice/model';
import { content } from '../src/samplePractice/content';
function memory() { const data = new Map<string,string>(); const storage: Storage = { getItem: async k => data.get(k) ?? null, setItem: async (k,v) => { data.set(k,v); }, removeItem: async k => { data.delete(k); } }; return { data, storage }; }
test('requires each choice; completes whole exercise and Back retains wording/choices', () => {
 let p = freshPractice(); assert.throws(() => advance(p));
 for (let i=0;i<3;i++) { p.choices[i]=i%2; p.wording[i]=`mine ${i}`; p=advance(p); }
 assert.equal(p.completed,true); assert.equal(p.step,3);
 const previous=back(p); assert.deepEqual(previous.choices,p.choices); assert.deepEqual(previous.wording,p.wording); assert.equal(previous.completed,true);
});
test('normal sequential saves, completion/reload, account isolation and readable reset', async () => {
 const {storage}=memory(); let p=await loadPractice(storage,'a');
 for(let i=0;i<3;i++) { p.choices[i]=i%2; p.wording[i]=`mine ${i}`; p=await savePractice(storage,'a',advance(p)); assert.deepEqual(await loadPractice(storage,'a'),p); }
 assert.equal(p.completed,true);
 assert.deepEqual(await loadPractice(storage,'b'),freshPractice());
 await resetPractice(storage,'b'); assert.deepEqual(await loadPractice(storage,'a'),p);
 const reset=await resetPractice(storage,'a'); assert.deepEqual(await loadPractice(storage,'a'),reset);
 assert.deepEqual({...reset,revision:null},freshPractice()); assert.notEqual(reset.revision,p.revision); assert.throws(()=>storageKey(''));
});
test('corruption fails closed and explicit reset repairs it without retaining private text', async () => {
 const {storage,data}=memory();
 for(const raw of ['{','null',JSON.stringify({...freshPractice(),version:2}),JSON.stringify({...freshPractice(),completed:true}),JSON.stringify({...freshPractice(),step:2}),JSON.stringify({...freshPractice(),revision:42})]) {
 data.set(storageKey('a'),raw); await assert.rejects(loadPractice(storage,'a')); assert.equal(data.get(storageKey('a')),raw);
 await assert.rejects(savePractice(storage,'a',freshPractice())); assert.equal(data.get(storageKey('a')),raw);
 const reset=await resetPractice(storage,'a'); assert.deepEqual(await loadPractice(storage,'a'),reset);
 }
 assert.throws(()=>validate({...freshPractice(),wording:['x'.repeat(1001),'','']}));
});
test('storage rejection surfaces and retries work; save before queued reset is erased', async () => {
 const {storage}=memory(); let fail=true; const flaky:Storage={...storage,setItem:async(k,v)=>{if(fail)throw Error('disk'); await storage.setItem(k,v);}};
 await assert.rejects(savePractice(flaky,'a',freshPractice())); fail=false;
 const saved=await savePractice(flaky,'a',freshPractice()); assert.deepEqual(await loadPractice(storage,'a'),saved);
 const pending=savePractice(storage,'a',{...saved,wording:['draft','','']}); const reset=resetPractice(storage,'a');
 const [,empty]=await Promise.all([pending,reset]); assert.deepEqual(await loadPractice(storage,'a'),empty); assert.deepEqual(empty.wording,['','','']);
 const broken={...storage,getItem:async()=>{throw Error('read');}}; await assert.rejects(loadPractice(broken,'a'));
});
test('old sibling private wording cannot be resurrected after reset, even by repeated retries', async () => {
 const {storage,data}=memory();
 const initial=await loadPractice(storage,'a');
 const old=await savePractice(storage,'a',{...initial,wording:['old private note','','']});
 const sibling=await loadPractice(storage,'a');
 const resetting=resetPractice(storage,'a');
 const stale=savePractice(storage,'a',{...sibling,choices:[0,null,null]});
 await assert.rejects(stale,StalePracticeError); const empty=await resetting;
 for(const snapshot of [initial,old,sibling]) await assert.rejects(savePractice(storage,'a',snapshot),StalePracticeError);
 assert.deepEqual(await loadPractice(storage,'a'),empty); assert.ok(!data.get(storageKey('a'))!.includes('old private note'));
 const reloaded=await loadPractice(storage,'a'); const next=await savePractice(storage,'a',{...reloaded,choices:[1,null,null]});
 assert.deepEqual(next.wording,['','','']);
});
test('two saves of one revision cannot overwrite each other; caller mutation cannot alter queued snapshot', async () => {
 const {storage}=memory(); const p=await loadPractice(storage,'a');
 const first=savePractice(storage,'a',{...p,wording:['first','','']});
 const second=savePractice(storage,'a',{...p,wording:['second','','']});
 await assert.rejects(second,StalePracticeError); const saved=await first;
 assert.deepEqual(await loadPractice(storage,'a'),saved);
 const pending=savePractice(storage,'a',saved); saved.wording[0]='mutated';
 assert.equal((await pending).wording[0],'first');
});
test('legacy v1 snapshots upgrade; durable revision checks notice writes outside the queue', async () => {
 const {storage,data}=memory(); const {revision: _revision,...legacy}=freshPractice();
 data.set(storageKey('a'),JSON.stringify({...legacy,wording:['legacy','','']}));
 const old=await loadPractice(storage,'a'); assert.equal(old.revision,null);
 const saved=await savePractice(storage,'a',old); assert.ok(saved.revision); assert.equal(saved.wording[0],'legacy');
 data.set(storageKey('a'),JSON.stringify({...freshPractice(),revision:'other-runtime-reset'}));
 await assert.rejects(savePractice(storage,'a',saved),StalePracticeError);
 assert.deepEqual((await loadPractice(storage,'a')).wording,['','','']);
});
test('both languages offer complete substantive paths and free urgent support copy',()=>{
 for(const language of ['en','es'] as const){const c=content[language]; assert.equal(c.steps.length,3); assert.ok(c.urgent.length>10); for(const s of c.steps){assert.equal(s.options.length,2);for(const o of s.options){assert.ok(o.why.length>140);assert.ok(o.response.length>10);assert.ok(o.reply.length>30);}}}
});
