import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>process.env.AUDIT_BASELINE_REF?execFileSync('git',['show',`${process.env.AUDIT_BASELINE_REF}:${p}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,p),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const flagged of [true,false])for(const delayed of [true,false])test(`real edge handler: model rejection; moderation flagged=${flagged}, delayed=${delayed}`,async()=>{
  let handler,moderationCalls=0,modelCalls=0;const moderation=deferred();
  const client={auth:{getUser:async()=>({data:{user:{id:'auth-A',email:'member@test.invalid'}}})},from(){return {select(){return this;},eq(){return this;},single:async()=>({data:{id:'account-A',type:'direct'}}),then(resolve){return Promise.resolve({data:[{tier:'essential',expires_at:null}]}).then(resolve);}};},rpc:async()=>({data:true,error:null})};
  const cache={};function load(p){if(cache[p])return cache[p];const module={exports:{}};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require(id){if(id.startsWith('npm:'))return {createClient:()=>client};return load(path.posix.normalize(path.posix.dirname(p)+'/'+id));},console,Response,Request,AbortController,setTimeout,clearTimeout,Deno:{env:{get:key=>key==='OPENAI_API_KEY'?'test-key':key==='SUPABASE_URL'?'http://127.0.0.1':key==='SUPABASE_ANON_KEY'?'test':''},serve:fn=>{handler=fn;}},fetch:async url=>{if(url.includes('/moderations')){moderationCalls++;if(delayed)await moderation.promise;return Response.json({results:[{categories:{'self-harm/intent':flagged}}]});}modelCalls++;return Response.json({error:'simulated provider failure'},{status:400});}});return cache[p]=module.exports;}
  const safety=load('supabase/functions/_shared/rehearsal-safety.ts');const text='There is no future left for me';assert.equal(safety.crisisKind(text),null);
  load('supabase/functions/rehearsal-partner/index.ts');
  const pending=handler(new Request('http://127.0.0.1/rehearsal',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({mode:'reply',scenario:{temperament:'guarded'},messages:[{role:'user',text}]})}));
  for(let i=0;i<40;i++)await Promise.resolve();moderation.resolve();const response=await pending,body=await response.json();
  assert.equal(moderationCalls,1);assert.equal(modelCalls,1);
  if(flagged){assert.equal(response.status,200);assert.equal(body.breakCharacter,true);assert.equal(body.crisisKind,'self_harm');assert.equal(body.audio,null);assert.equal(body.hint,null);}else{assert.equal(response.status,502);assert.equal(body.ok,false);}
});
