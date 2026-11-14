import { MAX_WEBSITE_SESSIONS, parseWebsiteSessions, zoomJoinUrl } from './website-coaching.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, received ${a}`);
}

const good = {
  id: 'bk-1',
  starts_at: '2027-01-15T18:00:00.000Z',
  ends_at: '2027-01-15T19:00:00.000Z',
  status: 'confirmed',
  kind: 'coaching',
  provider_name: 'Matt Brown',
  join_url: 'https://us02web.zoom.us/j/123?pwd=abc',
};

Deno.test('a well-formed session passes through with only the known fields', () => {
  const [session] = parseWebsiteSessions({ sessions: [{ ...good, zoom_passcode: 'x', client_phone: '555', amount_paid: 150 }] });
  assertEquals(session, good);
});

Deno.test('anything that is not a list of sessions is empty', () => {
  for (const payload of [null, undefined, 'text', 5, {}, { sessions: 'no' }, { sessions: null }, []]) {
    assertEquals(parseWebsiteSessions(payload), []);
  }
});

Deno.test('malformed sessions are dropped, the rest kept', () => {
  const sessions = parseWebsiteSessions({
    sessions: [
      good,
      null,
      'text',
      { ...good, id: '' },
      { ...good, id: 'bk-2', starts_at: 'not a date' },
      { ...good, id: 'bk-3', ends_at: good.starts_at },
      { ...good, id: 'bk-4', status: 'cancelled' },
      { ...good, id: 'bk-5', status: 'requested' },
      { ...good },
    ],
  });
  assertEquals(sessions.map((s) => s.id), ['bk-1']);
});

Deno.test('only a real https Zoom address is kept as the join link', () => {
  assertEquals(zoomJoinUrl('https://zoom.us/j/1'), 'https://zoom.us/j/1');
  assertEquals(zoomJoinUrl('https://us02web.zoom.us/j/1?pwd=a'), 'https://us02web.zoom.us/j/1?pwd=a');
  for (const bad of ['http://zoom.us/j/1', 'https://zoom.us.evil.example/j/1', 'https://evil.example/zoom.us', 'javascript:alert(1)', 'zoommtg://zoom.us/join', '', null, 5]) {
    assertEquals(zoomJoinUrl(bad), null);
  }
  const [session] = parseWebsiteSessions({ sessions: [{ ...good, join_url: 'https://evil.example/zoom.us/j/1' }] });
  assertEquals(session.join_url, null);
});

Deno.test('unknown kinds become coaching, completed is kept, names are trimmed', () => {
  const sessions = parseWebsiteSessions({
    sessions: [
      { ...good, kind: 'mystery', provider_name: '  Matt Brown  ' },
      { ...good, id: 'bk-2', kind: 'intensive', status: 'completed', provider_name: 7 },
    ],
  });
  assertEquals(sessions.map((s) => [s.kind, s.status, s.provider_name]), [['coaching', 'confirmed', 'Matt Brown'], ['intensive', 'completed', '']]);
});

Deno.test('sorted soonest first and capped', () => {
  const many = Array.from({ length: MAX_WEBSITE_SESSIONS + 20 }, (_, i) => ({
    ...good,
    id: `bk-${i}`,
    starts_at: new Date(Date.UTC(2027, 0, 1 + (MAX_WEBSITE_SESSIONS + 20 - i), 18)).toISOString(),
    ends_at: new Date(Date.UTC(2027, 0, 1 + (MAX_WEBSITE_SESSIONS + 20 - i), 19)).toISOString(),
  }));
  const sessions = parseWebsiteSessions({ sessions: many });
  assertEquals(sessions.length, MAX_WEBSITE_SESSIONS);
  assertEquals(sessions.map((s) => s.starts_at).join(), [...sessions.map((s) => s.starts_at)].sort().join());
  assertEquals(sessions[0].id, `bk-${MAX_WEBSITE_SESSIONS + 19}`);
});
