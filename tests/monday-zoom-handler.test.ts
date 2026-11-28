import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Deno uses .ts imports; keep its module out of the app TypeScript graph.
const { attendanceReport, zoomUuidPath } = require('../supabase/functions/_shared/monday-attendance.ts');

async function run(payload: unknown, options: { bearer?: string; incomplete?: boolean; repeat?: boolean } = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const writes: unknown[] = [];
  const calls: string[] = [];
  const source = readFileSync('supabase/functions/monday-zoom-attendance/index.ts', 'utf8')
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    attendanceReport, zoomUuidPath, Response, Request, URLSearchParams, AbortSignal, btoa, Date,
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => ({ SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'anon', ZOOM_ACCOUNT_ID: 'account', ZOOM_CLIENT_ID: 'client', ZOOM_CLIENT_SECRET: 'secret' } as Record<string,string>)[key] } },
    createClient: () => ({ rpc: async (name: string, args: unknown) => {
      if (name === 'admin_monday_meeting') return { error: { message: 'denied' } };
      if (name === 'service_monday_occurrence') return { data: 'actual/uuid' };
      writes.push(args); return { data: null };
    } }),
    fetch: async (url: string) => {
      calls.push(url);
      if (url.includes('/oauth/token')) return Response.json({ access_token: 'zoom-token' });
      if (!url.includes('/participants')) return Response.json({ uuid: 'actual/uuid', start_time: '2020-01-07T03:00:00Z', end_time: '2020-01-07T04:00:00Z' });
      return Response.json({ participants: [{user_email:'family@example.test',join_time:'2020-01-07T03:00:00Z',leave_time:'2020-01-07T03:20:00Z'}], total_records: options.incomplete ? 2 : 1, next_page_token: options.repeat ? 'same-token' : '' });
    },
  });
  const response = await handler(new Request('https://fixture.invalid', {method:'POST',headers:{Authorization:`Bearer ${options.bearer ?? 'service'}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}));
  return {response,writes,calls};
}
test('Zoom reconciliation rejects null payload and unauthorized member before external fetch', async () => {
  const invalid = await run(null); assert.equal(invalid.response.status,400); assert.equal(invalid.calls.length,0);
  const denied = await run({meeting_date:'2020-01-06'},{bearer:'member'}); assert.equal(denied.response.status,403); assert.equal(denied.calls.length,0);
});
test('Zoom reconciliation uses configured encoded UUID and only writes complete report', async () => {
  const good = await run({meeting_date:'2020-01-06',uuid:'injected'}); assert.equal(good.response.status,200); assert.equal(good.writes.length,1);
  assert(good.calls.some(url=>url.includes('actual%252Fuuid'))); assert(!good.calls.some(url=>url.includes('injected')));
  assert.equal((good.writes[0] as {p_rows:{seconds:number}[]}).p_rows[0].seconds,1200);
  for (const options of [{incomplete:true},{repeat:true}]) { const bad=await run({meeting_date:'2020-01-06'},options); assert.equal(bad.response.status,502); assert.equal(bad.writes.length,0); }
});
