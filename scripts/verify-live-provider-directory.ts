import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fetchProviders, fetchProviderById } from '../src/api/providers';
async function run() {
 const out=process.env.EVIDENCE_DIR || '/tmp/sh-provider-directory';
 const baseline=JSON.parse(await fs.readFile(`${out}/public-directory-baseline.json`,'utf8'));
 const providers=await fetchProviders('all');
 assert.deepEqual(providers.map(x=>x.id).sort(),baseline.map((x:{id:string})=>x.id).sort());
 const details=[];
 for(let start=0;start<providers.length;start+=4){
  const batch=await Promise.all(providers.slice(start,start+4).map(p=>fetchProviderById(p.id)));
  for(const p of batch){assert(p);details.push(p);}
 }
 const categories:Record<string,number>={};for(const p of providers)categories[p.category]=(categories[p.category]||0)+1;
 await fs.writeFile(`${out}/live-app-directory.json`,JSON.stringify({count:providers.length,detailCount:details.length,categories,providers},null,2));
 console.log(JSON.stringify({count:providers.length,detailCount:details.length,categories,exactWebsiteListingIds:true}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
