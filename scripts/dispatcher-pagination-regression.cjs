// Actual edge handler + disposable final-schema PostgREST (db-max-rows=1000).
// Only Expo is synthetic. Requires an empty, secret-free notification_* DB.
// node scripts/dispatcher-pagination-regression.cjs CONTAINER http://127.0.0.1:PORT
// PAGINATION_BASELINE_HANDLER=/absolute/baseline-handler.ts runs the same oracle RED.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const [container, url] = process.argv.slice(2);
assert.match(container || '', /^supabase_db_notification_[a-z0-9_]+$/);
assert.match(url || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
assert.equal(sql('SELECT count(*) FROM accounts'), '0', 'requires an empty disposable database');
assert.equal(sql('SELECT count(*) FROM vault.secrets'), '0', 'no provider credentials allowed');
assert.equal(sql('SELECT count(*) FROM net.http_request_queue'), '0');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.PAGINATION_BASELINE_HANDLER || path.join(root, 'supabase/functions/send-engagement-push/index.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const prefix = '97000000-0000-0000-0000-';
const aid = n => prefix + String(n).padStart(12, '0');
function seed(n, job) {
  assert.equal(sql('SELECT count(*) FROM accounts'), '0');
  sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
    SELECT ('96000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'pagination-'||i||'@example.invalid','{}','{}','authenticated','authenticated' FROM generate_series(1,${n}) i;
    UPDATE accounts SET id=('${prefix}'||right(user_id::text,12))::uuid, push_token='ExponentPushToken['||right(user_id::text,12)||']', family_call_reminders=true,daily_push_opt_in=true,created_at=now()-interval '10 days';
    ${job === 'session_reminder' ? "INSERT INTO session_rsvps(account_id,session_id,status) SELECT id,family_squares_session_id(),'going' FROM accounts;" : ''}`);
}
function cleanup() {
  sql("DELETE FROM auth.users WHERE id::text LIKE '96000000-0000-0000-0000-%'");
  assert.equal(sql('SELECT count(*) FROM accounts'), '0');
  assert.equal(sql('SELECT count(*) FROM push_recipient_deliveries'), '0');
}
async function rpc(name, args) {
  const response = await fetch(url + '/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  const data = await response.json();
  return response.ok ? { data, error: null } : { data: null, error: data };
}
function worker({ failToken, failPage } = {}) {
  let handler, failed = false;
  const sent = [], accepted = [], pages = [], deadlines = [];
  const db = { async rpc(name, args) {
    if (name === 'dispatcher_job_targets' && failPage && args.p_after_account_id && !failed) {
      failed = true; return { data: null, error: { message: 'synthetic page lookup failure' } };
    }
    const result = await rpc(name, args);
    if (name === 'dispatcher_job_targets') { pages.push(result.data?.length); deadlines.push(args.p_as_of); }
    return result;
  } };
  const sandbox = { exports: {}, console, Request, Response, Date, Map, Set, JSON, Promise,
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? url : 'synthetic-key' } },
    fetch: async (provider, options) => {
      assert.equal(provider, 'https://exp.host/--/api/v2/push/send');
      const messages = JSON.parse(options.body); sent.push(...messages);
      const data = messages.map(message => {
        assert.equal(message.ttl, undefined, 'absolute expiration must not be overridden');
        assert.ok(message.expiration > Date.now() / 1000);
        if (message.to === failToken && !failed) { failed = true; return { status: 'error', details: { error: 'MessageRateExceeded' } }; }
        accepted.push(message.to); return { status: 'ok', id: 'synthetic-ticket' };
      });
      return new Response(JSON.stringify({ data }));
    },
    require(name) {
      if (name.includes('/http/server.ts')) return { serve: fn => { handler = fn; } };
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('family-squares-time.ts')) return { isFamilySquaresReminderHour: () => true };
      if (name.endsWith('push-data.ts')) return { sessionReminderData: id => ({ session_id: id }), winbackData: () => ({}) };
      if (name.endsWith('push-policy.ts')) return { pushDeliveryPolicy: () => ({}) };
      throw Error(name);
    },
  };
  vm.runInNewContext(code, sandbox);
  return { sent, accepted, pages, deadlines, async run(job) {
    const response = await handler(new Request('http://synthetic.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic-key' }, body: JSON.stringify({ job, force: true }) }));
    return { status: response.status, body: await response.json() };
  } };
}
(async () => {
  const baseline = !!process.env.PAGINATION_BASELINE_HANDLER;
  let failures = 0;
  for (const job of ['session_reminder', 'family_call_30min', 'winback']) {
    for (const n of baseline ? [1001] : [0, 999, 1000, 1001, 2001]) {
      seed(n, job);
      try {
        const probe = await rpc('dispatcher_job_targets', { p_job: job, p_force: true });
        assert.equal(probe.error, null);
        assert.equal(probe.data.length, Math.min(n, 1000), 'actual PostgREST row cap');
        const w = worker();
        const first = await w.run(job), firstAccepted = w.accepted.length;
        const second = await w.run(job);
        const ledger = Number(sql('SELECT count(*) FROM push_recipient_deliveries WHERE sent_at IS NOT NULL'));
        const tail = n ? Number(sql(`SELECT count(*) FROM push_recipient_deliveries WHERE account_id='${aid(n)}' AND sent_at IS NOT NULL`)) : 0;
        console.log(JSON.stringify({ mode: baseline ? 'RED' : 'GREEN', job, n, first, second, firstAccepted, totalAccepted: w.accepted.length, ledger, tail, pages: w.pages }));
        if (baseline) { assert.equal(firstAccepted, 1000); failures++; }
        else {
          assert.equal(first.status, 200); assert.equal(second.status, 200);
          assert.equal(firstAccepted, n); assert.equal(w.accepted.length, n);
          assert.equal(new Set(w.accepted).size, n); assert.equal(ledger, n);
          assert.equal(tail, n ? 1 : 0);
          assert.ok(w.pages.includes(0), 'must exhaust pages, not stop on a short page');
          assert.equal(first.body.sent, n); assert.equal(second.body.sent, 0);
        }
      } finally { cleanup(); }
    }
    if (!baseline) {
      for (const mode of ['concurrent', 'provider-retry', 'page-retry']) {
        seed(1001, job);
        try {
          const a = worker(mode === 'provider-retry' ? { failToken: 'ExponentPushToken[000000001001]' } : mode === 'page-retry' ? { failPage: true } : {});
          const b = worker();
          const results = mode === 'concurrent' ? await Promise.all([a.run(job), b.run(job)]) : [await a.run(job), await b.run(job)];
          const all = [...a.accepted, ...b.accepted];
          assert.equal(all.length, 1001); assert.equal(new Set(all).size, 1001);
          assert.equal(sql('SELECT count(*) FROM push_recipient_deliveries WHERE sent_at IS NOT NULL'), '1001');
          assert.equal(sql('SELECT count(*) FROM push_recipient_deliveries WHERE processing_token IS NOT NULL'), '0');
          if (mode !== 'concurrent') assert.equal(results[0].status, 503);
          assert.equal(results[1].status, 200);
          console.log(JSON.stringify({ mode, job, results, accepted: all.length, unique: new Set(all).size }));
        } finally { cleanup(); }
      }
    }
  }
  assert.equal(sql('SELECT count(*) FROM vault.secrets'), '0');
  assert.equal(sql('SELECT count(*) FROM net.http_request_queue'), '0');
  console.log(baseline ? `RED confirmed: ${failures} jobs truncated on first invocation` : 'GREEN: 15 boundary cases + 9 concurrency/retry cases; fixtures removed');
})().catch(error => { console.error(error); process.exitCode = 1; });
