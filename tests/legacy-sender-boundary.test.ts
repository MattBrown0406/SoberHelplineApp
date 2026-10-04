// Actual handler + shared-module execution with synthetic IO only. No services.
// LEGACY_BASELINE_REF=HEAD reads old handlers without swapping the worktree.
import ts from 'typescript';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import vm from 'node:vm';
import { strict as assert } from 'node:assert';
// tsx loads the real shared module; require keeps Deno-only type imports out of app tsc.
const { dayDeadline, sessionDeadline } = require('../supabase/functions/_shared/legacy-sender-boundary.ts');

const root = new URL('../', import.meta.url);
const start = Date.parse('2026-10-01T13:00:00Z');
type Options = {
  mutate?: (s: State, q: Query) => void;
  afterSend?: (s: State) => void;
  provider?: string;
  endpoint?: string;
  role?: string;
  authorized?: boolean;
  force?: boolean;
  reminderHour?: boolean;
  rotateDuringDiscovery?: boolean;
  population?: number;
  service?: boolean;
  deliveries?: State['deliveries'];
  clock?: number;
  body?: Record<string, unknown>;
};
type Query = {
  table: string;
  filters: unknown[][];
  columns: string;
  single: boolean;
  patch?: unknown;
};
type State = ReturnType<typeof state>;
function state() {
  return {
    clock: start,
    sends: [] as Record<string, unknown>[],
    reads: [] as Query[],
    optIn: true,
    token: 'token-b',
    shared: true,
    member: true,
    owner: true,
    exists: true,
    checked: false,
    error: '',
    reject: '',
    session: true,
    source: true,
    claimed: false,
    deliveries: new Map<string, {token: string | null; accepted: boolean}>(),
    newer: false,
    tied: false,
    user: 'user',
    language: 'en',
    crisis: false,
    timezone: 'America/New_York',
    callReminders: true as boolean | null,
  };
}
async function run(endpoint: string, options: Options = {}) {
  const s = state();
  if (options.deliveries) s.deliveries = options.deliveries;
  if (options.clock !== undefined) s.clock = options.clock;
  let handler: (r: Request) => Promise<Response>;
  const account = (id: string) => ({
    id,
    user_id: s.user,
    first_name: 'Synthetic',
    locale: s.language,
    timezone: s.timezone,
    push_token: id === 'a' ? 'token-a' : s.token,
    daily_push_opt_in: s.optIn,
    family_call_reminders: s.callReminders,
    recent_checkins: s.crisis ? [{ mood: 1 }, { mood: 1 }, { mood: 1 }] : [],
    today_checkins: s.checked ? [{ checkin_date: '2026-10-01' }] : [],
    tracker_logs: [],
    loved_ones: { status: 'unknown' },
  });
  const event = () => ({
    id: 'event',
    account_id: 'owner',
    shared_wall_id: 'wall',
    shared_with_family: s.shared,
    created_at: new Date(start - 60000).toISOString(),
    notification_claimed_at: s.claimed ? 'claimed' : null,
  });
  const db = {
    auth: { getUser: () => {
      assert.ok(!options.service, 'service retry must not impersonate a user');
      return Promise.resolve({ data: { user: options.authorized === false ? null : {id:'user'} }, error: null });
    } },
    from(table: string) {
      const q: Query = { table, filters: [], columns: '', single: false };
      const chain: Record<string, unknown> = {};
      for (
        const method of [
          'eq',
          'in',
          'is',
          'not',
          'gte',
          'lte',
          'lt',
          'gt',
          'order',
          'limit',
          'range',
          'neq',
        ]
      ) {
        chain[method] = (...args: unknown[]) => {
          q.filters.push([method, ...args]);
          return chain;
        };
      }
      chain.select = (columns: string) => {
        q.columns = columns;
        return chain;
      };
      chain.update = (patch: unknown) => {
        q.patch = patch;
        return chain;
      };
      chain.maybeSingle = () => {
        q.single = true;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void, reject: (v: unknown) => void) =>
        Promise.resolve().then(() => {
          s.reads.push(q);
          options.mutate?.(s, q);
          if (s.reject === table || (s.reject === 'checkins' && q.columns.includes('checkins('))) {
            throw Error('synthetic lookup rejection');
          }
          if (s.error === table || (s.error === 'checkins' && q.columns.includes('checkins('))) {
            return { data: null, error: { message: 'synthetic lookup failure' } };
          }
          const id = q.filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2] as string;
          let data: unknown = null;
          if (table === 'accounts') {
            data = q.single
              ? (s.exists ? account(id ?? 'owner') : null)
              : [account('a'), account('b')];
            if (!q.single && options.rotateDuringDiscovery) {
              s.token = 'rotated-during-discovery';
              const tokens = q.filters.find((f) => f[0] === 'in' && f[1] === 'push_token')?.[2] as
                | string[]
                | undefined;
              data = [account('a'), account('b')].filter((a) =>
                !tokens || tokens.includes(a.push_token)
              );
            }
          }
          if (table === 'wavering_events') {
            data = s.source
              ? {
                ...event(),
                id: s.newer ? 'new-private-event' : 'event',
                shared_with_family: s.newer ? false : s.shared,
                accounts: account('owner'),
                shared_walls: {
                  id: 'wall',
                  family_space_id: 'family',
                  family_spaces: {
                    family_members: [
                      ...(s.owner ? [{ account_id: 'owner', accounts: account('owner') }] : []),
                      ...(s.member && s.exists
                        ? ['a', 'b'].map((id) => ({ account_id: id, accounts: account(id) }))
                        : []),
                    ],
                  },
                },
              }
              : null;
            if (q.patch) {
              s.claimed = true;
              data = { shared_wall_id: 'wall' };
            }
          }
          if (table === 'wavering_events' && !q.single && !q.patch) {
            data = data
              ? [
                data,
                ...(s.tied ? [{ ...event(), id: 'private-tie', shared_with_family: false }] : []),
              ]
              : [];
          }
          if (table === 'shared_walls') {
            data = s.source ? { id: 'wall', family_space_id: 'family' } : null;
          }
          if (table === 'family_members') {
            const who = q.filters.find((f) => f[1] === 'account_id')?.[2];
            data = q.single
              ? ((who === 'owner' ? s.owner : s.member) ? { id: 'membership' } : null)
              : [{ account_id: 'a' }, { account_id: 'b' }];
          }
          if (table === 'checkins') {
            data = s.checked ? [{ account_id: 'b', checkin_date: '2026-10-01', mood: 4 }] : [];
          }
          if (table === 'tracker_logs' || table === 'loved_ones') data = [];
          if (table === 'messages') {
            data = s.source && s.exists
              ? {
                id: 'message',
                thread_id: 'thread',
                sender_role: options.role ?? 'coach',
                created_at: new Date(start).toISOString(),
                threads: { account_id: 'b', accounts: account('b') },
              }
              : null;
          }
          if (table === 'session_rsvps') {
            const who = q.filters.find((f) => f[1] === 'account_id')?.[2] as string;
            data = q.single
              ? (s.session && s.exists ? { account_id: who, accounts: account(who) } : null)
              : (s.session ? [{ account_id: 'a' }, { account_id: 'b' }] : []);
            if (!q.single && options.rotateDuringDiscovery) s.token = 'rotated-during-discovery';
          }
          if (
            options.population && !q.single && (table === 'accounts' || table === 'session_rsvps')
          ) {
            const ids = Array.from(
              { length: options.population },
              (_, i) => `p${String(i).padStart(4, '0')}`,
            );
            const cursor = q.filters.find((f) => f[0] === 'gt')?.[2] as string | undefined;
            const range = q.filters.find((f) => f[0] === 'range');
            const limit = (q.filters.find((f) => f[0] === 'limit')?.[1] as number | undefined) ??
              1000;
            const page = ids.filter((id) => !cursor || id > cursor).slice(
              range ? Number(range[1]) : 0,
              range ? Number(range[2]) + 1 : limit,
            );
            data = page.map((id) => table === 'accounts' ? account(id) : { account_id: id });
          }
          return { data, error: null };
        }).then(resolve, reject);
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const q: Query = { table: name, filters: [], columns: '', single: false };
      s.reads.push(q);
      options.mutate?.(s, q);
      if (s.reject === name) throw Error('synthetic rejection');
      if (s.error === name) return { data: null, error: { message: 'synthetic error' } };
      if (name === 'claim_push_recipient') {
        const key = String(args.p_account_id);
        const previous = s.deliveries.get(key);
        if (previous?.accepted || previous?.token) return {data:null,error:null};
        const token = `lease-${key}`;
        s.deliveries.set(key,{token,accepted:false});
        return {data:token,error:null};
      }
      if (name === 'finish_push_recipient') {
        const record = s.deliveries.get(String(args.p_account_id));
        if (!record || record.token !== args.p_processing_token) return {data:false,error:null};
        record.token=null;record.accepted=args.p_accepted === true;
        return {data:true,error:null};
      }
      const data = name === 'get_session_reminder_targets'
        ? (s.session
          ? [{ push_token: 'token-a', locale: 'en' }, { push_token: s.token, locale: 'en' }]
          : [])
        : name === 'family_squares_session_id'
        ? (s.source ? 'session' : null)
        : name === 'get_thread_member_info'
        ? (s.exists ? [{ account_id: 'b', first_name: 'Synthetic', push_token: s.token }] : [])
        : name === 'get_account_push_token_by_email'
        ? s.token
        : null;
      return { data, error: null };
    },
  };
  class Clock extends Date {
    constructor(...args: unknown[]) {
      super((args.length ? args[0] : s.clock) as number);
    }
    static override now() {
      return s.clock;
    }
  }
  const cache = new Map<string, unknown>();
  function load(path: string): unknown {
    if (cache.has(path)) return cache.get(path);
    const baseline = process.env.LEGACY_BASELINE_REF;
    const text = baseline && path.endsWith('/index.ts')
      ? execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' })
      : readFileSync(new URL(path, root), 'utf8');
    const exports = {};
    const context = {
      exports,
      console: { error() {}, warn() {} },
      Request,
      Response,
      Date: Clock,
      Intl,
      Map,
      Set,
      JSON,
      Promise,
      Deno: {
        env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://synthetic.invalid' : 'key' },
        serve: (fn: typeof handler) => {
          handler = fn;
        },
      },
      fetch: (_url: string, opts: { body: string }) => {
        const payload = JSON.parse(opts.body);
        const messages = Array.isArray(payload) ? payload : [payload];
        s.sends.push(...messages);
        options.afterSend?.(s);
        if (options.provider === 'throw') return Promise.reject(Error('network'));
        if (options.provider === 'http') {
          return Promise.resolve(
            new Response('{}', { status: 503 }),
          );
        }
        const tickets = messages.map(() =>
          options.provider === 'ticket'
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: options.provider === 'empty-id' ? '' : 'ticket' }
        );
        return Promise.resolve(
          new Response(JSON.stringify(
            options.provider === 'malformed'
              ? {}
              : { data: Array.isArray(payload) ? tickets : tickets[0] },
          )),
        );
      },
      require: (name: string): unknown =>
        name.includes('supabase-js')
          ? { createClient: () => db }
          : name.endsWith('family-squares-time.ts')
          ? { isFamilySquaresReminderHour: () => options.reminderHour ?? true }
          : name.endsWith('admin.ts')
          ? { ADMIN_EMAILS: ['coach@example.invalid', 'coach2@example.invalid'] }
          : load(new URL(name, new URL(path, root)).pathname.slice(root.pathname.length)),
    };
    cache.set(path, exports);
    vm.runInNewContext(
      ts.transpileModule(text, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      context,
    );
    return exports;
  }
  load(`supabase/functions/${endpoint}/index.ts`);
  const response = await handler!(
    new Request('https://synthetic.invalid', {
      method: 'POST',
      headers: { Authorization: options.authorized === false ? 'Bearer wrong' : endpoint === 'notify-family-backup' && !options.service ? 'Bearer user-key' : 'Bearer key' },
      body: JSON.stringify({
        force: options.force ?? true,
        wavering_event_id: 'event',
        record: { id: 'message', thread_id: 'thread', sender_role: options.role ?? 'coach' },
        ...options.body,
      }),
    }),
  );
  return { ...s, status: response.status, body: await response.text(), replay: async (mutate?: (s: State) => void) => {
    s.error = ''; s.reject = ''; options.mutate = undefined; options.afterSend = undefined; options.provider = undefined;
    mutate?.(s);
    const before = s.sends.length;
    const response = await handler(new Request('https://synthetic.invalid', {method:'POST',headers:{Authorization:'Bearer user-key'},body:JSON.stringify({wavering_event_id:'event'})}));
    return {status:response.status, body:JSON.parse(await response.text()), sends:s.sends.slice(before)};
  } };
}
for (
  const endpoint of [
    'daily-nudge',
    'notify-daily-morning',
    'notify-session-reminder',
    'notify-family-backup',
  ]
) {
  test(`${endpoint}: valid control sends with absolute provider expiry`, async () => {
    const r = await run(endpoint);
    assert.equal(r.sends.length, 2);
    assert.ok(r.sends.every((m) => Number(m.expiration) > start / 1000));
    assert.ok(r.sends.every((m) => !('ttl' in m)));
  });
  test(`${endpoint}: later send rechecks consent/membership`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.optIn = false;
        s.member = false;
        s.session = false;
        s.shared = false;
      },
    });
    assert.equal(r.sends.length, 1);
  });
  test(`${endpoint}: expiry during IO drops later delivery`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.clock += 86400000;
      },
    });
    assert.equal(r.sends.length, 1);
  });
  for (const provider of ['ticket', 'http', 'malformed', 'throw', 'empty-id']) {
    test(`${endpoint}: provider ${provider} not counted as sent`, async () => {
      const r = await run(endpoint, { provider });
      assert.ok(!r.body.includes('sent 2'));
      if (r.body.startsWith('{')) assert.equal(JSON.parse(r.body).sent, 0);
    });
  }
}
test('family: private event during recipient discovery prevents first send', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s, q) => {
      if (q.table === 'accounts' && !q.single) s.shared = false;
    },
  });
  assert.equal(r.sends.length, 0);
});
test('family: removed recipient during discovery prevents send', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s, q) => {
      if (q.table === 'accounts' && !q.single) s.member = false;
    },
  });
  assert.equal(r.sends.length, 0);
});
test('family: removed source membership prevents later send', async () => {
  const r = await run('notify-family-backup', {
    afterSend: (s) => {
      s.owner = false;
    },
  });
  assert.equal(r.sends.length, 1);
});
test('daily nudge: returned checkin error is not empty eligibility', async () => {
  const r = await run('daily-nudge', {
    mutate: (s, q) => {
      if (q.table === 'checkins' || q.columns.includes('checkins(')) s.error = 'checkins';
    },
  });
  assert.equal(r.sends.length, 0);
  assert.equal(r.status, 500);
});
test('daily nudge: rejected embedded checkin read fails safely', async () => {
  const r = await run('daily-nudge', {
    mutate: (s, q) => {
      if (q.table === 'checkins' || q.columns.includes('checkins(')) s.reject = 'checkins';
    },
  });
  assert.equal(r.sends.length, 0);
  assert.equal(r.status, 500);
});
test('daily nudge: checkin during first send suppresses second', async () => {
  const r = await run('daily-nudge', {
    afterSend: (s) => {
      s.checked = true;
    },
  });
  assert.equal(r.sends.length, 1);
});
test('chat: token switch during locale read never sends cached token', async () => {
  const r = await run('notify-chat-message', {
    mutate: (s, q) => {
      if (q.table === 'accounts' || q.table === 'messages') s.token = 'new-token';
    },
  });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].to, 'new-token');
});
test('chat: removed account during locale read prevents send', async () => {
  const r = await run('notify-chat-message', {
    mutate: (s, q) => {
      if (q.table === 'accounts' || q.table === 'messages') s.exists = false;
    },
  });
  assert.equal(r.sends.length, 0);
});
test('chat: missing source message prevents sends', async () => {
  const r = await run('notify-chat-message', {
    mutate: (s) => {
      s.source = false;
    },
  });
  assert.equal(r.sends.length, 0);
});
for (const provider of ['ticket', 'http', 'malformed', 'throw', 'empty-id']) {
  test(`chat: ${provider} is reported`, async () => {
    const r = await run('notify-chat-message', { provider });
    assert.ok(r.status >= 400);
  });
}

for (
  const endpoint of [
    'daily-nudge',
    'notify-daily-morning',
    'notify-session-reminder',
    'notify-family-backup',
  ]
) {
  test(`${endpoint}: switched token before second boundary is fresh`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.token = 'replacement';
      },
    });
    assert.equal(r.sends.length, 2);
    assert.equal(r.sends[1].to, 'replacement');
  });
  test(`${endpoint}: deleted recipient before second boundary is skipped`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.exists = false;
      },
    });
    assert.equal(r.sends.length, 1);
  });
  test(`${endpoint}: delayed sends retain original absolute deadline`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.clock += 60000;
      },
    });
    assert.equal(r.sends.length, 2);
    assert.equal(r.sends[1].expiration, r.sends[0].expiration);
    assert.ok(!('ttl' in r.sends[1]));
  });
  const table = endpoint === 'notify-family-backup'
    ? 'wavering_events'
    : endpoint === 'notify-session-reminder'
    ? 'session_rsvps'
    : 'accounts';
  for (const kind of ['error', 'reject'] as const) {
    test(`${endpoint}: final lookup ${kind} is not ineligibility/success`, async () => {
      const r = await run(endpoint, {
        afterSend: (s) => {
          s[kind] = table;
        },
      });
      assert.equal(r.sends.length, 1);
      assert.ok(r.status >= 500);
      const body = JSON.parse(r.body);
      assert.equal(body.sent, 1);
      assert.equal(body.failed, 1);
      assert.equal(body.retryable, 1);
    });
  }
  test(`${endpoint}: expiry inside final lookup suppresses Expo`, async () => {
    const r = await run(endpoint, {
      mutate: (s, q) => {
        if (
          q.table === table &&
          (q.columns.includes('!inner') || q.columns.includes('recent_checkins:'))
        ) s.clock += 86400000;
      },
    });
    assert.equal(r.sends.length, 0);
  });
}
for (const endpoint of ['daily-nudge', 'notify-daily-morning']) {
  test(`${endpoint}: consent withdrawn during initial discovery`, async () => {
    const r = await run(endpoint, {
      mutate: (s, q) => {
        if (q.table === 'accounts' && !q.single) s.optIn = false;
      },
    });
    assert.equal(r.sends.length, 0);
  });
  test(`${endpoint}: safety band changed before second boundary changes copy`, async () => {
    const r = await run(endpoint, {
      afterSend: (s) => {
        s.crisis = true;
      },
    });
    assert.equal(r.sends.length, 2);
    assert.notEqual(r.sends[1].body, r.sends[0].body);
    assert.ok(String(r.sends[1].body).match(/pause|breath/));
  });
  test(`${endpoint}: Spanish current locale remains supported`, async () => {
    const r = await run(endpoint, {
      mutate: (s) => {
        s.language = 'es';
      },
    });
    assert.equal(r.sends.length, 2);
    assert.ok(String(r.sends[0].title).match(/Tus|Buenos/));
  });
}
test('family: newly inserted private event prevents later send', async () => {
  const r = await run('notify-family-backup', {
    afterSend: (s) => {
      s.newer = true;
    },
  });
  assert.equal(r.sends.length, 1);
});
test('family: source account identity changed after discovery is rejected', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s, q) => {
      if (q.table === 'accounts' && !q.single) s.user = 'other';
    },
  });
  assert.equal(r.sends.length, 0);
});
test('family: preclaim lookup failure is retryable, not 404', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s, q) => {
      if (q.table === 'wavering_events') s.error = q.table;
    },
  });
  assert.equal(r.status, 500);
  assert.equal(JSON.parse(r.body).retryable, true);
  assert.equal(r.claimed, false);
});
test('family: daily optout does not revoke explicit family share', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s) => {
      s.optIn = false;
    },
  });
  assert.equal(r.sends.length, 2);
});
test('session: daily optout does not revoke independent going RSVP', async () => {
  const r = await run('notify-session-reminder', {
    mutate: (s) => {
      s.optIn = false;
    },
  });
  assert.equal(r.sends.length, 2);
});
test('session: Monday call reminder switched off is not sent despite a going RSVP', async () => {
  for (const value of [false, null]) {
    const r = await run('notify-session-reminder', {
      mutate: (s) => {
        s.callReminders = value;
      },
    });
    assert.equal(r.sends.length, 0);
    assert.equal(JSON.parse(r.body).skipped, 2);
  }
});
test('session: Monday call reminder switched off before second boundary is honoured', async () => {
  const r = await run('notify-session-reminder', {
    afterSend: (s) => {
      s.callReminders = false;
    },
  });
  assert.equal(r.sends.length, 1);
});
test('session: normal schedule guard and operator force retained', async () => {
  const skipped = await run('notify-session-reminder', { reminderHour: false, force: false });
  assert.equal(skipped.sends.length, 0);
  assert.equal(skipped.reads.length, 0);
  const forced = await run('notify-session-reminder', { reminderHour: false, force: true });
  assert.equal(forced.sends.length, 2);
  assert.equal(forced.sends[0].expiration, start / 1000 + 900);
});
test('chat: member path sends only generic body to every coach', async () => {
  const r = await run('notify-chat-message', { role: 'member' });
  assert.equal(r.sends.length, 2);
  assert.ok(r.sends.every((m) => m.body === 'Open Sober Helpline to read this private message.'));
});
test('chat: removed source after first coach prevents later coach send', async () => {
  const r = await run('notify-chat-message', {
    role: 'member',
    afterSend: (s) => {
      s.source = false;
    },
  });
  assert.equal(r.sends.length, 1);
});
test('chat: coach token RPC errors fail closed', async () => {
  const r = await run('notify-chat-message', {
    role: 'member',
    mutate: (s, q) => {
      if (q.table === 'get_account_push_token_by_email') s.error = q.table;
    },
  });
  assert.equal(r.sends.length, 0);
  assert.equal(r.status, 500);
});
for (
  const endpoint of [
    'daily-nudge',
    'notify-daily-morning',
    'notify-session-reminder',
    'notify-chat-message',
  ]
) {
  test(`${endpoint}: unauthenticated request cannot read/send`, async () => {
    const r = await run(endpoint, { authorized: false });
    assert.equal(r.status, 401);
    assert.equal(r.sends.length, 0);
    assert.equal(r.reads.length, 0);
  });
}

test('family: private equal-timestamp event fails closed regardless of UUID order', async () => {
  const r = await run('notify-family-backup', {
    mutate: (s, q) => {
      if (q.table === 'wavering_events' && q.columns.includes('!inner')) {
        s.tied = true;
        assert.ok(q.filters.some((f) => f[0] === 'gte' && f[1] === 'created_at'));
        assert.ok(!q.filters.some((f) => f[0] === 'eq' && f[1] === 'shared_with_family'));
      }
    },
  });
  assert.equal(r.sends.length, 0);
});
for (const endpoint of ['daily-nudge', 'notify-daily-morning', 'notify-session-reminder']) {
  test(`${endpoint}: discovery covers recipients beyond the row cap`, async () => {
    const r = await run(endpoint, { population: 1001 });
    const final = r.reads.filter((q) =>
      q.single && (
        q.columns.includes('recent_checkins:') || q.table === 'session_rsvps'
      )
    );
    assert.equal(final.length, 1001);
    assert.ok(final.some((q) => q.filters.some((f) => f[0] === 'eq' && f[2] === 'p1000')));
  });
}
test('morning: discovery delay cannot renew original day deadline', async () => {
  const r = await run('notify-daily-morning', {
    mutate: (s, q) => {
      if (q.table === 'accounts' && !q.single) s.clock += 86400000;
    },
  });
  assert.equal(r.sends.length, 0);
});
test('morning: the 16:00 UTC run never says "Good morning" outside her morning', async () => {
  // 13:00 UTC is 10 PM in Tokyo and 2 PM in London.
  for (const timezone of ['Asia/Tokyo', 'Europe/London']) {
    const r = await run('notify-daily-morning', {
      mutate: (s) => {
        s.timezone = timezone;
      },
    });
    assert.equal(r.sends.length, 0);
    assert.equal(JSON.parse(r.body).skipped, 2);
  }
  // Noon on the East Coast is still her morning.
  const noon = await run('notify-daily-morning', { clock: Date.parse('2026-10-01T16:00:00Z') });
  assert.equal(noon.sends.length, 2);
});
test('morning: "It\'s Monday" means Monday where she is', async () => {
  const monday = await run('notify-daily-morning', { clock: Date.parse('2026-10-05T16:00:00Z') });
  assert.equal(monday.sends.length, 2);
  assert.ok(monday.sends.every((m) => m.title === 'Family call tonight'));
  // Sunday 8 PM UTC is Monday 9 AM in Auckland.
  const auckland = await run('notify-daily-morning', {
    clock: Date.parse('2026-10-04T20:00:00Z'),
    body: { mode: 'local' },
    mutate: (s) => {
      s.timezone = 'Pacific/Auckland';
    },
  });
  assert.equal(auckland.sends.length, 2);
  assert.ok(auckland.sends.every((m) => m.title === 'Family call tonight'));
  // Monday 8 PM UTC is already Tuesday 9 AM in Auckland.
  const tuesday = await run('notify-daily-morning', {
    clock: Date.parse('2026-10-05T20:00:00Z'),
    body: { mode: 'local' },
    mutate: (s) => {
      s.timezone = 'Pacific/Auckland';
    },
  });
  assert.equal(tuesday.sends.length, 2);
  assert.ok(tuesday.sends.every((m) => m.title !== 'Family call tonight'));
});
test('morning: hourly local mode reaches each member at 9 AM her time only', async () => {
  const nine = await run('notify-daily-morning', { body: { mode: 'local' } });
  assert.equal(nine.sends.length, 2);
  // Same instant is 8 AM in Chicago: not her hour.
  const eight = await run('notify-daily-morning', {
    body: { mode: 'local' },
    mutate: (s) => {
      s.timezone = 'America/Chicago';
    },
  });
  assert.equal(eight.sends.length, 0);
  // Shown no later than midnight her time.
  assert.ok(nine.sends.every((m) => m.expiration === Date.parse('2026-10-02T04:00:00Z') / 1000));
});
test('session: token rotation during discovery preserves eligible recipient', async () => {
  const r = await run('notify-session-reminder', { rotateDuringDiscovery: true });
  assert.equal(r.sends.length, 2);
  assert.equal(r.sends[1].to, 'rotated-during-discovery');
});
test('absolute local-day expiry preserves the 23-hour spring DST day', () => {
  assert.equal(
    new Date(dayDeadline(Date.parse('2026-03-08T05:00:00Z'), 'America/New_York')).toISOString(),
    '2026-03-09T04:00:00.000Z',
  );
});
test('absolute local-day expiry preserves the 25-hour fall DST day', () => {
  assert.equal(
    new Date(dayDeadline(Date.parse('2026-11-01T04:00:00Z'), 'America/New_York')).toISOString(),
    '2026-11-02T05:00:00.000Z',
  );
});

test('family: overlapping user and service retry sends each recipient once', async () => {
  const deliveries=state().deliveries;
  const runs=await Promise.all([run('notify-family-backup',{deliveries}),run('notify-family-backup',{deliveries,service:true})]);
  assert.equal(runs.reduce((n,r)=>n+r.sends.length,0),2);
  assert.equal(deliveries.size,2);
  assert.ok([...deliveries.values()].every(d=>d.accepted));
});
for (const service of [false,true]) {
  test(`family: ${service?'service':'user'} retry retains withdrawal guard`,async()=>{
    const r=await run('notify-family-backup',{service,mutate(s){s.shared=false;}});
    assert.equal(r.sends.length,0);
  });
}
test('family: invalid user credential cannot reserve or send',async()=>{
  const r=await run('notify-family-backup',{authorized:false});
  assert.equal(r.status,401);assert.equal(r.reads.length,0);assert.equal(r.sends.length,0);
});
for (const failure of ['discovery', 'lookup', 'http', 'partial']) {
  test(`family durable retry after ${failure}, accepted recipients are not resent`, async () => {
    const r = await run('notify-family-backup', {
      provider: failure === 'http' ? 'http' : undefined,
      mutate(s,q) {
        if (failure === 'discovery' && q.table === 'family_members' && !q.single) s.error=q.table;
        if (failure === 'lookup' && q.columns.includes('!inner')) s.error=q.table;
      },
      afterSend: failure === 'partial' ? s => {s.error='wavering_events';} : undefined,
    });
    assert.ok(r.status >= 500);
    const retried = await r.replay();
    assert.equal(retried.status,200);
    assert.equal(retried.sends.length,failure === 'partial' ? 1 : 2);
    assert.equal((await r.replay()).sends.length,0);
    assert.equal(r.claimed,false,'event-wide claim is never consumed');
  });
}
for (const change of ['withdrawal','membership','token']) {
  test(`family retry revalidates ${change}`, async () => {
    const r=await run('notify-family-backup',{provider:'http'});
    const retry=await r.replay(s=>{ if(change==='withdrawal') s.shared=false; else if(change==='membership') s.member=false; else s.token='rotated-retry'; });
    assert.equal(retry.sends.length,change==='token'?2:0);
    if(change==='token') assert.equal(retry.sends[1].to,'rotated-retry');
  });
}

test('scheduled session expiry is the actual 19:00 Pacific occurrence', () => {
  assert.equal(
    new Date(sessionDeadline(Date.parse('2026-10-06T01:45:00Z'))).toISOString(),
    '2026-10-06T02:00:00.000Z',
  );
});
