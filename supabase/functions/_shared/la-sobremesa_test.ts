import { isLaSobremesaReminderHour, parseAyudaRegistration, validPersonalJoinUrl } from './la-sobremesa.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('only personal Zoom join links are accepted', () => {
  const link = 'https://us06web.zoom.us/w/83949611525?tk=abc.DEF-123&pwd=xyz';
  assertEquals(validPersonalJoinUrl(link), link);
  assertEquals(validPersonalJoinUrl('https://us06web.zoom.us/j/83949611525?pwd=abc'), 'https://us06web.zoom.us/j/83949611525?pwd=abc');
  assertEquals(validPersonalJoinUrl('https://us06web.zoom.us/s/83949611525?zak=host'), null);
  assertEquals(validPersonalJoinUrl('https://evil.example/zoom.us/w/123456789?x=1'), null);
  assertEquals(validPersonalJoinUrl('javascript:alert(1)'), null);
  assertEquals(validPersonalJoinUrl(42), null);
});

Deno.test("AyudaSobria's answer is validated before anything is stored", () => {
  assertEquals(
    parseAyudaRegistration(200, { joinUrl: 'https://zoom.us/w/123456789?tk=a', startsAt: '2026-10-13T03:00:00Z' }),
    { ok: true, joinUrl: 'https://zoom.us/w/123456789?tk=a', startsAt: '2026-10-13T03:00:00.000Z' },
  );
  assertEquals(parseAyudaRegistration(404, {}), { ok: false, status: 'not_available' });
  assertEquals(parseAyudaRegistration(502, {}), { ok: false, status: 'error' });
  assertEquals(parseAyudaRegistration(200, { joinUrl: 'https://zoom.us/w/123456789?tk=a' }), { ok: false, status: 'error' });
});

Deno.test('La Sobremesa reminders go out in the Monday 7 PM Pacific hour (PDT and PST)', () => {
  assertEquals(isLaSobremesaReminderHour(new Date('2026-10-13T02:45:00Z')), true); // Mon 7:45 PM PDT
  assertEquals(isLaSobremesaReminderHour(new Date('2026-10-13T03:45:00Z')), false); // Mon 8:45 PM PDT
  assertEquals(isLaSobremesaReminderHour(new Date('2026-11-10T03:45:00Z')), true); // Mon 7:45 PM PST
  assertEquals(isLaSobremesaReminderHour(new Date('2026-11-10T02:45:00Z')), false); // Mon 6:45 PM PST
});
