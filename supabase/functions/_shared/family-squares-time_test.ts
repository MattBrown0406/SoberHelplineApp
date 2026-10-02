import { isFamilySquaresReminderHour, nextFamilySquaresStart, validZoomJoinUrl } from './family-squares-time.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('summer (PDT): the 01:00 UTC run sends, the 02:00 UTC run does not', () => {
  assert(isFamilySquaresReminderHour(new Date('2026-09-29T01:00:00Z')), '01:00 UTC Tue = 6 PM PDT Mon');
  assert(!isFamilySquaresReminderHour(new Date('2026-09-29T02:00:00Z')), '02:00 UTC Tue = 7 PM PDT Mon');
});

Deno.test('winter (PST): the 02:00 UTC run sends, the 01:00 UTC run does not', () => {
  assert(!isFamilySquaresReminderHour(new Date('2026-11-03T01:00:00Z')), '01:00 UTC Tue = 5 PM PST Mon');
  assert(isFamilySquaresReminderHour(new Date('2026-11-03T02:45:00Z')), '02:45 UTC Tue = 6:45 PM PST Mon');
});

Deno.test('the next call is the coming Monday at 7 PM Pacific, PDT or PST', () => {
  // Friday Oct 2 2026 → Monday Oct 5, 7 PM PDT = Tue 02:00 UTC.
  assert(nextFamilySquaresStart(new Date('2026-10-02T18:00:00Z')).toISOString() === '2026-10-06T02:00:00.000Z', 'PDT Monday');
  // Friday Nov 6 2026 (after the switch) → Monday Nov 9, 7 PM PST = Tue 03:00 UTC.
  assert(nextFamilySquaresStart(new Date('2026-11-06T18:00:00Z')).toISOString() === '2026-11-10T03:00:00.000Z', 'PST Monday');
  // Monday 7:30 PM PDT, mid-call → still tonight's call.
  assert(nextFamilySquaresStart(new Date('2026-10-06T02:30:00Z')).toISOString() === '2026-10-06T02:00:00.000Z', 'during the call');
  // Monday 8:30 PM PDT, after the call → next week.
  assert(nextFamilySquaresStart(new Date('2026-10-06T03:30:00Z')).toISOString() === '2026-10-13T02:00:00.000Z', 'after the call');
});

Deno.test('only real Zoom join links are accepted from the website', () => {
  assert(validZoomJoinUrl('https://us06web.zoom.us/j/81514017886?pwd=abcDEF123.1') !== null, 'web zoom link');
  assert(validZoomJoinUrl('https://zoom.us/j/81514017886') !== null, 'plain zoom link');
  assert(validZoomJoinUrl('https://evil.example.com/j/81514017886') === null, 'other host');
  assert(validZoomJoinUrl('https://zoom.us.evil.com/j/81514017886') === null, 'lookalike host');
  assert(validZoomJoinUrl('javascript:alert(1)') === null, 'script');
  assert(validZoomJoinUrl(42) === null, 'not a string');
});
