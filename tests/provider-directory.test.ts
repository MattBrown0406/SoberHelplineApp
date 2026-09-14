import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Only the public directory transport is mocked. Execute the production adapter.
let handler: (url: URL, init?: RequestInit) => Response | Promise<Response>;
globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
let api: typeof import('../src/api/providers');
test.before(async () => { api = await import(process.env.PROVIDER_MODULE ? pathToFileURL(process.env.PROVIDER_MODULE).href : '../src/api/providers.ts'); });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number) => ({id:id(n),status:'approved',provider_name:'Same provider name',category:'Outpatient Treatment',city:`City ${n}`,state:'Oregon',description_of_services:'Public description',insurances_accepted:['Aetna']});
const response = (data: unknown, range: string, status=200) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json','Content-Range':range}});

test('all listings survive server pagination and identical names; public fields only', async () => {
 const records=Array.from({length:105},(_,n)=>row(n));const offsets:number[]=[];
 handler=(url)=>{
  assert(url.pathname.endsWith('/provider_submissions_public'));
  assert.equal(url.searchParams.get('status'),'eq.approved');
  assert.equal(url.searchParams.get('category'),null);
  const select=url.searchParams.get('select')!;
  assert(!select.includes('*'));
  for(const field of ['submitted_by','phone_number','email','address'])assert(!select.split(',').includes(field));
  assert.equal(url.searchParams.get('order'),'provider_name.asc,id.asc');
  const offset=Number(url.searchParams.get('offset'));offsets.push(offset);
  const batch=records.slice(offset,offset+40); // smaller server cap than client page size
  return response(batch,`${offset}-${offset+batch.length-1}/105`);
 };
 const results=await api.fetchProviders('all');assert.equal(results.length,105);
 assert.deepEqual(offsets,[0,40,80]);assert.equal(new Set(results.map((x:any)=>x.id)).size,105);
 assert(results.every((x:any)=>x.availability==='unverified'));
 assert(results.every((x:any)=>!x.levels.includes('PHP')&&!x.levels.includes('IOP')));
});

test('type, state and insurance filters reach public query',async()=>{
 handler=(url)=>{assert.equal(url.searchParams.get('state'),'eq.Oregon');assert(url.searchParams.get('insurances_accepted')?.includes('Aetna'));assert(url.searchParams.get('category')?.includes('Medical Detox'));return response([{...row(1),category:'Medical Detox'}],'0-0/1');};
 const result=await api.fetchProviders('center',{loc:'detox',state:'Oregon',insurance:['Aetna']});assert.deepEqual(result[0].levels,['Detox']);
});

test('detail uses approved public listing and malformed IDs do not query',async()=>{
 let calls=0;handler=url=>{calls++;assert.equal(url.searchParams.get('status'),'eq.approved');assert.equal(url.searchParams.get('id'),`eq.${id(1)}`);return response([row(1)],'0-0/1');};
 assert.equal((await api.fetchProviderById(id(1)))?.id,id(1));assert.equal(await api.fetchProviderById('../private'),undefined);assert.equal(calls,1);
});

test('pagination fails closed on missing totals, unapproved rows and later-page errors', async () => {
 handler=()=>new Response(JSON.stringify([row(1)]),{headers:{'Content-Type':'application/json'}});
 await assert.rejects(()=>api.fetchProviders('all'),/incomplete/);
 handler=()=>response([{...row(1),status:'pending'}],'0-0/1');
 await assert.rejects(()=>api.fetchProviders('all'),/Invalid public listing/);
 let calls=0;
 handler=()=>++calls===1 ? response([row(1)],'0-0/2') : response({message:'later page denied'},'*/0',403);
 await assert.rejects(()=>api.fetchProviders('all'));
 assert.equal(calls,2);
});

test('empty, unavailable, incomplete and failed responses are distinct',async()=>{
 handler=()=>response([],'*/0');assert.deepEqual(await api.fetchProviders('all'),[]);assert.equal(await api.fetchProviderById(id(1)),undefined);
 handler=()=>response([],'*/20');await assert.rejects(()=>api.fetchProviders('all'),/incomplete/);
 handler=()=>response([row(1),row(1)],'0-1/2');await assert.rejects(()=>api.fetchProviders('all'),/changed/);
 handler=()=>response({message:'denied'},'*/0',403);await assert.rejects(()=>api.fetchProviders('all'));await assert.rejects(()=>api.fetchProviderById(id(1)));
});
