// Executes the real edge handler with synthetic IO; never connects to a service.
// AUDIT_BASELINE_REF=HEAD demonstrates the regressions without swapping files.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = (file) => process.env.AUDIT_BASELINE_REF
  ? execFileSync('git', ['show', `${process.env.AUDIT_BASELINE_REF}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
const compile = (file) => ts.transpileModule(source(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = { exports: {} };
vm.runInNewContext(compile('supabase/functions/_shared/push-policy.ts'), policy);
let clock = Date.parse('2026-10-01T20:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
async function run({ kind = 'invitation_window', eligibility = 900, error, reject = false,
  expiry = '2026-10-01T20:30:00Z', attempt = 0, authorized = true, metadata, writeError = false, provider = 'ok',
  rowCount = 1, eligibilityHook, providerHook, deliveryHook, reservationHook, finishHook, pageHook, pageSize = 1000, job = "drain", force = false } = {}) {
  clock = Date.parse('2026-10-01T20:00:00Z');
  const calls = [], updates = [], sent = [], batches = [];
  let handler;
  const row = { id: 'row', account_id: 'account', kind, title: 'Synthetic', body: 'Synthetic',
    metadata: metadata ?? (kind === 'practice_incoming' ? { event_id: 'event', expires_at: expiry } : { kind }),
    attempt_count: attempt, processing_token: 'lease', expires_at: kind === 'practice_incoming' ? null : expiry };
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'claim_push_outbox') return { data: Array.from({ length: rowCount }, (_, i) => ({ ...row, id: rowCount === 1 ? 'row' : `row-${i}`, metadata: kind === 'practice_incoming' && rowCount > 1 ? { ...row.metadata, event_id: `row-${i}` } : row.metadata })), error: null };
      if (name === 'dispatcher_job_targets') {
        if (pageHook) return pageHook(args);
        return { data: Array.from({ length: rowCount }, (_, i) => ({ account_id: `account-${i}`, push_token: 'stale-token', locale: 'en', session_id: 'session', expires_at: expiry }))
          .sort((a, b) => a.account_id < b.account_id ? -1 : 1)
          .filter(row => !args.p_after_account_id || row.account_id > args.p_after_account_id).slice(0, pageSize), error: null };
      }
      if (name === 'finish_push_recipient') return finishHook ? finishHook(args) : { data: !writeError, error: writeError ? {message:'ack failed'} : null };
      if (name === 'claim_dispatcher_job') {
        if (reservationHook) return reservationHook(args);
        const result = deliveryHook ? await deliveryHook({ name, args, sent, calls }) : { data: {push_token:'current-token',ttl:900}, error:null };
        if (result.data && result.data.push_token) result.data = {...result.data, processing_token:'lease', reservation_kind:job,event_key:'occurrence'};
        return result;
      }
      if (name === 'dispatcher_outbox_delivery' || name === 'dispatcher_job_delivery') {
        if (deliveryHook) return deliveryHook({ name, args, sent, calls });
        return { data: { push_token: 'ExponentPushToken[synthetic]', ttl: kind === 'group_live' ? null : eligibility, expires_at: null }, error: null };
      }
      assert.ok(['practice_push_delivery_ttl', 'invitation_push_delivery_ttl'].includes(name));
      if (eligibilityHook) return eligibilityHook({ name, args, sent, calls });
      if (reject) throw new Error('synthetic unavailable');
      return { data: eligibility, error: error ? { code: '503', message: 'synthetic unavailable' } : null };
    },
    from(table) {
      let patch;
      const filters = [];
      const query = {
        select() { return query; },
        in(...args) { filters.push(['in', ...args]); return query; },
        eq(...args) { filters.push(['eq', ...args]); return query; },
        is(...args) { filters.push(['is', ...args]); return query; },
        update(value) { patch = value; updates.push({ table, patch, filters }); return query; },
        then(resolve, reject) { return Promise.resolve(table === 'accounts' && !patch
          ? { data: [{ id: 'account', push_token: 'ExponentPushToken[synthetic]' }], error: null }
          : { data: null, error: writeError ? { message: 'synthetic write error' } : null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const sandbox = { exports: {}, console: { error() {} }, Request, Response, Date: FixedDate, Map, Set, JSON, Promise,
    Deno: { env: { get: (name) => name === 'SUPABASE_URL' ? 'http://synthetic.invalid' : 'synthetic-key' } },
    fetch: async (url, opts) => {
      assert.equal(url, 'https://exp.host/--/api/v2/push/send');
      const messages = JSON.parse(opts.body); sent.push(...messages); batches.push(messages);
      if (providerHook) return providerHook({ messages, batches });
      if (provider === 'throw') throw new Error('synthetic network failure');
      if (provider === 'http') return new Response('{}', { status: 503 });
      if (provider === 'malformed') return new Response('{}');
      if (provider === 'ticket') return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) }));
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'synthetic-ticket' })) }));
    },
    require(name) {
      if (name.includes('/http/server.ts')) return { serve(fn) { handler = fn; } };
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('push-policy.ts')) {
        return { pushDeliveryPolicy: (kind, expiry) => policy.exports.pushDeliveryPolicy(kind, expiry, clock) };
      }
      if (name.endsWith('push-data.ts')) return { winbackData: () => ({ kind: 'winback' }), sessionReminderData: (id) => ({ kind: 'session_reminder', session_id: id }) };
      if (name.endsWith('family-squares-time.ts')) return { isFamilySquaresReminderHour: () => true };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compile('supabase/functions/send-engagement-push/index.ts'), sandbox);
  const response = await handler(new Request('http://synthetic.invalid/drain', {
    method: 'POST', headers: { Authorization: authorized ? 'Bearer synthetic-key' : 'Bearer wrong' },
    body: JSON.stringify({ job, force }),
  }));
  return { status: response.status, body: await response.json(), calls, updates, sent, batches,
    deliver: sandbox.sendExpoPushResults };
}
function deadline(message, seconds, base = '2026-10-01T20:00:00Z') {
  assert.equal(message.expiration, Date.parse(base) / 1000 + seconds);
  assert.equal(message.ttl, undefined, 'relative ttl overrides absolute expiration');
}
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
test('stale backlog never reaches Expo', async () => {
  const r = await run({ expiry: '2026-09-30T21:00:00Z' });
  assert.equal(r.sent.length, 0);
  assert.equal(r.updates[0].patch.last_error, 'invitation_expired_or_ineligible');
});
test('legacy invitation without expiry fails closed', async () => {
  const r = await run({ expiry: null }); assert.equal(r.sent.length, 0);
});
for (const cause of ['withdrawal', 'serious safety', 'access loss', 'outcome hold', 'changed local day']) {
  test(`confirmed invitation ${cause} never reaches Expo`, async () => {
    const r = await run({ eligibility: null });
    assert.equal(r.sent.length, 0);
    assert.equal(r.calls[1].name, 'invitation_push_delivery_ttl');
    assert.equal(r.calls[1].args.p_processing_token, 'lease');
    assert.ok(r.updates[0].patch.failed_at);
  });
}
test('current invitation uses remaining server TTL, not a fresh four hours', async () => {
  const r = await run(); assert.equal(r.sent.length, 1); deadline(r.sent[0], 900);
});
test('absolute invitation expiry caps even an excessive server TTL', async () => {
  const r = await run({ eligibility: 14400 }); deadline(r.sent[0], 1800);
});
for (const kind of ['practice_incoming', 'invitation_window']) {
  for (const failure of ['error', 'reject']) test(`${kind} ${failure} preserves bounded retry`, async () => {
    const r = await run({ kind, [failure]: true });
    assert.equal(r.status, 200); assert.equal(r.sent.length, 0);
    const u = r.updates[0];
    assert.equal(u.patch.failed_at, null); assert.equal(u.patch.attempt_count, 1);
    assert.equal(u.patch.last_error, 'eligibility_lookup_failed');
    assert.equal(u.patch.processing_token, null);
    assert.equal(u.patch.scheduled_for, '2026-10-01T20:01:00.000Z');
    assert.ok(!('expires_at' in u.patch));
    assert.ok(u.filters.some(f => f[1] === 'processing_token' && f[2] === 'lease'));
  });
  test(`${kind} fifth lookup failure exhausts retry budget distinctly`, async () => {
    const r = await run({ kind, error: true, attempt: 4 });
    assert.ok(r.updates[0].patch.failed_at);
    assert.equal(r.updates[0].patch.last_error, 'eligibility_lookup_failed');
  });
}
for (const eligibility of [null, 0]) test(`practice authoritative ${eligibility} is terminal`, async () => {
  const r = await run({ kind: 'practice_incoming', eligibility });
  assert.equal(r.sent.length, 0); assert.equal(r.updates[0].patch.last_error, 'practice_expired_or_ineligible');
});
test('eligible practice retains remaining TTL', async () => {
  const r = await run({ kind: 'practice_incoming', eligibility: 240 }); deadline(r.sent[0], 240);
});
test('malformed eligibility is retryable, not authoritative ineligibility', async () => {
  const r = await run({ kind: 'practice_incoming', eligibility: 'broken' });
  assert.equal(r.sent.length, 0); assert.equal(r.updates[0].patch.failed_at, null);
});
test('write failure is surfaced', async () => {
  const r = await run({ error: true, writeError: true }); assert.equal(r.status, 500);
});
test('unrelated notifications retain their behavior', async () => {
  const r = await run({ kind: 'group_live' }); assert.equal(r.sent.length, 1); assert.equal(r.sent[0].ttl, undefined);
});
test('unauthorized drain never touches IO', async () => {
  const r = await run({ authorized: false }); assert.equal(r.status, 401); assert.equal(r.calls.length, 0); assert.equal(r.sent.length, 0);
});
test('final provider boundary drops newly expired work without shifting ticket indexes', async () => {
  const r = await run({ authorized: false });
  const results = await r.deliver([
    { to: 'expired', ttl: 900, expiresAt: '2026-10-01T19:59:59Z' },
    { to: 'current', ttl: 900, expiresAt: '2026-10-01T20:01:00Z' },
    { to: 'ordinary' },
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].error, 'push_expired');
  assert.equal(results[1].ok, true); assert.equal(results[2].ok, true);
  assert.deepEqual(r.sent.map(m => m.to), ['current', 'ordinary']);
  deadline(r.sent[0], 60);
  assert.ok(!('expiresAt' in r.sent[0]));
});
test('all-expired provider chunk does not issue a network request', async () => {
  const r = await run({ authorized: false });
  const results = await r.deliver([{ to: 'expired', expiresAt: '2026-09-30T20:00:00Z' }]);
  assert.equal(results[0].error, 'push_expired'); assert.equal(r.sent.length, 0);
});
test('provider boundary preserves expiry and ordering across chunks', async () => {
  const r = await run({ authorized: false });
  const messages = Array.from({ length: 102 }, (_, i) => ({ to: String(i),
    expiresAt: i % 2 ? '2026-10-01T20:05:00Z' : '2026-09-30T20:00:00Z' }));
  const results = await r.deliver(messages);
  assert.equal(results.length, 102); assert.equal(r.sent.length, 51);
  results.forEach((v, i) => assert.equal(v.ok, !!(i % 2)));
});
for (const provider of ['throw', 'http', 'malformed', 'ticket']) {
  test(`mixed expired/provider ${provider} keeps per-row result ordering`, async () => {
    const r = await run({ authorized: false, provider });
    const cleared = [];
    const results = await r.deliver([
      { to: 'expired', expiresAt: '2026-09-30T20:00:00Z' }, { to: 'active' },
    ], async tokens => { cleared.push(...tokens); });
    assert.equal(results.length, 2); assert.equal(results[0].error, 'push_expired');
    assert.equal(results[1].ok, false); assert.notEqual(results[1].error, 'push_expired');
    assert.deepEqual(cleared, provider === 'ticket' ? ['active'] : []);
  });
}
for (const kind of ['invitation_window', 'practice_incoming']) {
test(`101 ${kind}: withdrawal during first in-flight chunk blocks final message`, async () => {
  let validClaim = true;
  const r = await run({ kind, rowCount: 101,
    eligibilityHook: ({ args }) => {
      if (kind === 'invitation_window') assert.equal(args.p_processing_token, 'lease');
      else assert.equal(args.p_account_id, 'account');
      return { data: validClaim ? 900 : null, error: null };
    },
    providerHook: ({ messages }) => {
      // This request has already crossed the provider boundary and cannot be recalled.
      validClaim = false;
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'synthetic-ticket' })) }));
    },
  });
  assert.equal(r.sent.length, 100);
  assert.deepEqual(r.batches.map(b => b.length), [100]);
  assert.equal(r.body.sent, 100);
  const canceled = r.updates.find(u => u.patch.last_error === `${kind === 'invitation_window' ? 'invitation' : 'practice'}_expired_or_ineligible`);
  assert.ok(canceled);
  assert.ok(canceled.filters.some(f => f[1] === 'id' && f[2] === 'row-100'));
  assert.ok(canceled.filters.some(f => f[1] === 'processing_token' && f[2] === 'lease'));
});
for (const failure of ['error', 'reject', 'malformed']) test(`${kind} second chunk eligibility ${failure} is retryable`, async () => {
  const r = await run({ kind, rowCount: 101, eligibilityHook: ({ sent }) => {
    if (!sent.length) return { data: 900, error: null };
    if (failure === 'reject') throw new Error('synthetic unavailable');
    return failure === 'error' ? { data: null, error: { message: 'unavailable' } } : { data: 'broken', error: null };
  } });
  assert.equal(r.sent.length, 100);
  const retry = r.updates.find(u => u.patch.last_error === 'eligibility_lookup_failed');
  assert.ok(retry); assert.equal(retry.patch.failed_at, null);
  assert.equal(retry.patch.attempt_count, 1);
  assert.equal(retry.patch.scheduled_for, '2026-10-01T20:01:00.000Z');
  assert.equal(retry.patch.processing_token, null);
  assert.ok(!('expires_at' in retry.patch));
  assert.ok(retry.filters.some(f => f[1] === 'id' && f[2] === 'row-100'));
  assert.ok(retry.filters.some(f => f[1] === 'processing_token' && f[2] === 'lease'));
});
test(`${kind} mixed second-chunk eligibility preserves ticket-to-outbox mapping and refreshed TTL`, async () => {
  const r = await run({ kind, rowCount: 104, eligibilityHook: ({ args, sent }) => {
    if (!sent.length) return { data: 900, error: null };
    if ((args.p_outbox_id ?? args.p_event_id) === 'row-100') return { data: null, error: null };
    if ((args.p_outbox_id ?? args.p_event_id) === 'row-102') return { data: null, error: { message: 'unavailable' } };
    return { data: 60, error: null };
  }, providerHook: ({ messages, batches }) => new Response(JSON.stringify({ data: messages.map((_, i) =>
    batches.length === 2 && i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'synthetic-ticket' }) })) });
  assert.deepEqual(r.batches.map(b => b.length), [100, 2]);
  r.batches[1].forEach(m => deadline(m, 60));
  const errorRow = (reason, id) => {
    const u = r.updates.find(u => u.patch.last_error === reason);
    assert.ok(u, reason); assert.ok(u.filters.some(f => f[1] === 'id' && f[2] === id));
  };
  errorRow(`${kind === 'invitation_window' ? 'invitation' : 'practice'}_expired_or_ineligible`, 'row-100');
  errorRow('DeviceNotRegistered', 'row-101');
  errorRow('eligibility_lookup_failed', 'row-102');
  const successes = r.updates.find(u => u.patch.sent_at).filters.find(f => f[1] === 'id')[2];
  assert.equal(successes.length, 101); assert.equal(successes.at(-1), 'row-103');
  assert.equal(r.body.sent, 101);
});
test(`${kind} provider-boundary fifth lookup failure exhausts budget without false ineligibility`, async () => {
  const r = await run({ kind, rowCount: 101, attempt: 4,
    eligibilityHook: ({ sent }) => sent.length ? { data: null, error: { message: 'unavailable' } } : { data: 900, error: null } });
  assert.equal(r.sent.length, 100);
  const u = r.updates.find(u => u.patch.last_error === 'eligibility_lookup_failed');
  assert.ok(u.patch.failed_at); assert.equal(u.patch.attempt_count, 5);
  assert.ok(!r.updates.some(u => u.patch.last_error === `${kind === 'invitation_window' ? 'invitation' : 'practice'}_expired_or_ineligible`));
});
}
for (const kind of ['practice_incoming', 'invitation_window']) {
  for (const delay of [120000, 300000]) test(`${kind} delayed provider chunk uses original absolute expiry (${delay})`, async () => {
    const r = await run({ kind, rowCount: 101, eligibility: 240, expiry: '2026-10-01T20:04:00Z',
      providerHook: ({ messages }) => {
        clock += delay;
        return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'synthetic-ticket' })) }));
      } });
    assert.deepEqual(r.batches.map(b => b.length), delay < 240000 ? [100, 1] : [100]);
    if (delay < 240000) deadline(r.batches[1][0], 240);
    else assert.ok(r.updates.some(u => u.patch.last_error === 'push_expired' && u.patch.failed_at));
    assert.ok(r.sent.every(m => !('expiresAt' in m)));
  });
}
for (const expiry of [null, 'broken', '2026-09-30T20:00:00Z']) test(`practice invalid original expiry ${expiry} fails closed`, async () => {
  const r = await run({ kind: 'practice_incoming', expiry });
  assert.equal(r.sent.length, 0);
});
for (const cause of ['optout', 'access loss', 'answered event']) test(`practice ${cause} at first chunk is terminal`, async () => {
  let checks = 0;
  const r = await run({ kind: 'practice_incoming', eligibilityHook: () => ({ data: ++checks === 1 ? 240 : null, error: null }) });
  assert.equal(r.sent.length, 0);
  assert.equal(r.updates[0].patch.last_error, 'practice_expired_or_ineligible');
  assert.ok(r.updates[0].patch.failed_at);
});
for (const eligibility of [NaN, Infinity, -Infinity, undefined]) test(`nonfinite practice eligibility ${eligibility} retries`, async () => {
  const r = await run({ kind: 'practice_incoming', eligibilityHook: () => ({ data: eligibility, error: null }) });
  assert.equal(r.sent.length, 0); assert.equal(r.updates[0].patch.failed_at, null);
  assert.equal(r.updates[0].patch.last_error, 'eligibility_lookup_failed');
});
test('practice missing event id fails closed', async () => {
  const r = await run({ kind: 'practice_incoming', metadata: { expires_at: '2026-10-01T20:30:00Z' } });
  assert.equal(r.sent.length, 0);
  assert.equal(r.updates[0].patch.last_error, 'practice_expired_or_ineligible');
});
test('practice expiry during final eligibility lookup never reaches provider', async () => {
  let checks = 0;
  const r = await run({ kind: 'practice_incoming', expiry: '2026-10-01T20:04:00Z', eligibilityHook: () => {
    if (++checks === 2) clock += 240000;
    return { data: 240, error: null };
  } });
  assert.equal(r.sent.length, 0);
  assert.equal(r.updates[0].patch.last_error, 'push_expired');
});
const allKinds = ['group_live', 'community_support', 'admin_community_report', 'situation_brief',
  'admin_invitation_yes', 'admin_textline_message', 'admin_refund_owed', 'admin_video_request',
  'member_video_scheduled', 'member_video_counteroffer', 'member_video_live', 'member_video_cancelled',
  'member_video_completed', 'member_video_no_show', 'coach_video_accepted', 'coach_video_cancelled',
  'coach_video_reschedule', 'premier_video_reminder', 'coach_video_reminder', 'practice_incoming', 'invitation_window', 'member_plan_update_requested'];
for (const kind of allKinds) {
  test(`${kind}: authoritative final denial is terminal`, async () => {
    const r = await run({ kind, deliveryHook: ({ args }) => {
      assert.equal(args.p_processing_token, 'lease');
      return { data: null, error: null };
    } });
    assert.equal(r.sent.length, 0);
    assert.ok(r.updates.some(u => u.patch.last_error === 'push_ineligible' && u.patch.failed_at));
  });
  test(`${kind}: refresh destination and absolute deadline`, async () => {
    const r = await run({ kind, deliveryHook: () => ({ data: { push_token: 'current-owner-token', ttl: 900,
      expires_at: '2026-10-01T20:02:00Z' }, error: null }) });
    assert.equal(r.sent.length, 1); assert.equal(r.sent[0].to, 'current-owner-token'); deadline(r.sent[0], 120);
  });
  for (const failure of ['error', 'reject', 'malformed']) test(`${kind}: final ${failure} preserves retry`, async () => {
    const r = await run({ kind, deliveryHook: () => {
      if (failure === 'reject') throw new Error('unavailable');
      return { data: failure === 'malformed' ? {} : null, error: failure === 'error' ? { message: 'unavailable' } : null };
    } });
    assert.equal(r.sent.length, 0);
    assert.ok(r.updates.some(u => u.patch.last_error === 'eligibility_lookup_failed' && !u.patch.failed_at));
  });
}
for (const job of ['session_reminder', 'family_call_30min', 'winback']) {
  test(`${job}: stale target denied after selection`, async () => {
    const r = await run({ job, deliveryHook: () => ({ data: null, error: null }) });
    assert.equal(r.sent.length, 0); assert.equal(r.status, 200);
    assert.ok(!r.calls.some(c => c.name === 'mark_winback_sent'));
  });
  test(`${job}: current token and original deadline survive delayed chunks`, async () => {
    const r = await run({ job, rowCount: 101, expiry: '2026-10-01T20:04:00Z',
      deliveryHook: () => ({ data: { push_token: 'current-token', ttl: 99999, expires_at: '2026-10-01T20:04:00Z' }, error: null }),
      providerHook: ({ messages }) => { clock += 120000; return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: 'synthetic-ticket' })) })); } });
    assert.equal(r.sent.length, 101); deadline(r.batches[1][0], 240);
    assert.ok(r.sent.every(m => m.to === 'current-token'));
  });
  test(`${job}: permissions revoked in first provider flight stop second chunk`, async () => {
    const r = await run({ job, rowCount: 101, deliveryHook: ({ sent }) => ({ data: sent.length ? null : { push_token: 'current-token', ttl: 600 }, error: null }) });
    assert.equal(r.sent.length, 100);
  });
  test(`${job}: eligibility failure is retryable, not successful denial`, async () => {
    const r = await run({ job, deliveryHook: () => ({ data: null, error: { message: 'unavailable' } }) });
    assert.equal(r.sent.length, 0); assert.equal(r.status, 503);
  });
}
test('authorized force reaches both target and delivery contracts', async () => {
  const r = await run({ job: 'family_call_30min', force: true });
  assert.ok(r.calls.filter(c => c.name.startsWith('dispatcher_job_')).every(c => c.args.p_force === true));
  assert.equal(r.sent.length, 1);
});
test('operator preview does not queue a 30-minute message until next week', async () => {
  const r = await run({ job: 'family_call_30min', force: true, expiry: '2026-10-06T02:00:00Z',
    deliveryHook: () => ({ data: { push_token: 'current', expires_at: '2026-10-06T02:00:00Z' }, error: null }) });
  deadline(r.sent[0], 1800);
});
for (const id of [undefined, null, '', 123]) test(`ok ticket without valid id ${id} cannot mark sent`, async () => {
  const r = await run({ providerHook: ({ messages }) => new Response(JSON.stringify({
    data: messages.map(() => ({ status: 'ok', id })) })) });
  assert.equal(r.body.sent, 0);
  assert.ok(!r.updates.some(u => u.patch.sent_at));
});
test('provider-boundary zero TTL never goes to Expo', async () => {
  const r = await run({ deliveryHook: () => ({ data: { push_token: 'current', ttl: 0 }, error: null }) });
  assert.equal(r.sent.length, 0);
});

for (const job of ['session_reminder','family_call_30min','winback']) {
  function ledger() {
    const rows=new Map(); let next=0;
    return {
      reservationHook(args) {
        const key=args.p_account_id;
        if(rows.has(key)) return {data:null,error:null};
        const token=`lease-${++next}`; rows.set(key,token);
        return {data:{push_token:'current-token',processing_token:token,reservation_kind:job,event_key:'occurrence',ttl:900},error:null};
      },
      finishHook(args) {
        assert.equal(rows.get(args.p_account_id),args.p_processing_token);
        if(args.p_accepted) rows.set(args.p_account_id,'accepted'); else rows.delete(args.p_account_id);
        return {data:true,error:null};
      },
    };
  }
  test(`${job}: overlapping workers reserve once and accepted replay sends nothing`,async()=>{
    const hooks=ledger();
    const runs=await Promise.all([run({job,...hooks}),run({job,...hooks})]);
    assert.equal(runs.flatMap(r=>r.sent).length,1);
    assert.equal((await run({job,...hooks})).sent.length,0);
  });
  test(`${job}: provider 503 releases occurrence for retry`,async()=>{
    const hooks=ledger();
    const failed=await run({job,...hooks,provider:'http'});
    assert.equal(failed.body.sent,0);assert.equal(failed.status,503);
    const retry=await run({job,...hooks});assert.equal(retry.body.sent,1);
    assert.equal((await run({job,...hooks})).sent.length,0);
  });
  test(`${job}: mixed tickets retry only failed recipient`,async()=>{
    const hooks=ledger();
    const first=await run({job,...hooks,rowCount:2,providerHook:({messages})=>new Response(JSON.stringify({data:messages.map((_,i)=>i?{status:'error',details:{error:'MessageRateExceeded'}}:{status:'ok',id:'ticket'})}))});
    assert.equal(first.body.sent,1);
    const retry=await run({job,...hooks,rowCount:2});assert.equal(retry.body.sent,1);
    assert.equal(retry.sent.length,1);
  });
  test(`${job}: rejected ACK is surfaced without pretending durable completion`,async()=>{
    const r=await run({job,writeError:true});assert.equal(r.status,503);assert.equal(r.body.sent,1);
  });
}

for (const job of ['session_reminder', 'family_call_30min', 'winback']) {
  for (const rowCount of [0, 999, 1000, 1001, 2001]) test(`${job}: keyset boundary ${rowCount}`, async () => {
    const r = await run({ job, rowCount });
    assert.equal(r.status, 200); assert.equal(r.body.sent, rowCount);
    const claims = r.calls.filter(c => c.name === 'claim_dispatcher_job');
    assert.equal(new Set(claims.map(c => c.args.p_account_id)).size, rowCount);
    const pages = r.calls.filter(c => c.name === 'dispatcher_job_targets');
    assert.equal(pages.length, Math.ceil(rowCount / 1000) + 1);
    assert.equal(new Set(pages.map(c => c.args.p_as_of)).size, 1);
  });
  test(`${job}: short API pages still drain to empty`, async () => {
    const r = await run({ job, rowCount: 101, pageSize: 17 });
    assert.equal(r.body.sent, 101);
    assert.equal(r.calls.filter(c => c.name === 'dispatcher_job_targets').length, 7);
  });
  for (const failure of ['error', 'throw', 'null', 'repeat']) test(`${job}: ${failure} page fails bounded`, async () => {
    const r = await run({ job, pageHook: args => {
      if (!args.p_after_account_id) return { data: [{ account_id: 'account-0', push_token: 'stale', locale: 'en', session_id: 'session', expires_at: '2026-10-01T20:30:00Z' }], error: null };
      if (failure === 'throw') throw Error('page unavailable');
      if (failure === 'error') return { data: null, error: { message: 'page unavailable' } };
      return { data: failure === 'null' ? null : [{ account_id: 'account-0' }], error: null };
    } });
    assert.equal(r.status, 503); assert.equal(r.body.sent, 1);
    assert.equal(r.body.retryable, 1); assert.equal(r.sent.length, 1);
  });
}

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} actual-handler regressions passed; synthetic IO only`);
  process.exitCode = failed ? 1 : 0;
})();
