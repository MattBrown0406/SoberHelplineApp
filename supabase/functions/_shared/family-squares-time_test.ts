import {
  familySquaresSyncWindow,
  isFamilySquaresReminderHour,
  nextFamilySquaresStart,
  pacificDate,
  validZoomJoinUrl,
} from './family-squares-time.ts';

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

Deno.test('the website sync names the Pacific date of the next call and when the last one ended', () => {
  const check = (now: string, date: string, start: string, previousEnd: string, label: string) => {
    const w = familySquaresSyncWindow(new Date(now));
    assert(w.meetingDate === date, `${label}: date ${w.meetingDate}`);
    assert(w.start.toISOString() === start, `${label}: start ${w.start.toISOString()}`);
    assert(w.previousCallEnd.toISOString() === previousEnd, `${label}: previous end ${w.previousCallEnd.toISOString()}`);
  };
  // Friday → the coming Monday (7 PM PDT is Tuesday 02:00 UTC, still Monday in Pacific).
  check('2026-10-02T18:00:00Z', '2026-10-05', '2026-10-06T02:00:00.000Z', '2026-09-29T03:00:00.000Z', 'friday');
  // Mid-call it is still tonight's call.
  check('2026-10-06T02:30:00Z', '2026-10-05', '2026-10-06T02:00:00.000Z', '2026-09-29T03:00:00.000Z', 'during');
  // After 8 PM it moves to next week, and tonight's call is the previous one.
  check('2026-10-06T03:30:00Z', '2026-10-12', '2026-10-13T02:00:00.000Z', '2026-10-06T03:00:00.000Z', 'after');
  // Fall back (Nov 1 2026): the previous call ended at 8 PM PDT, this one starts 7 PM PST.
  check('2026-10-30T18:00:00Z', '2026-11-02', '2026-11-03T03:00:00.000Z', '2026-10-27T03:00:00.000Z', 'fall back');
  // Spring forward (Mar 14 2027): previous ended 8 PM PST, this one starts 7 PM PDT.
  check('2027-03-12T18:00:00Z', '2027-03-15', '2027-03-16T02:00:00.000Z', '2027-03-09T04:00:00.000Z', 'spring forward');
});

Deno.test('pacific dates follow the Pacific calendar, not UTC', () => {
  assert(pacificDate(new Date('2026-10-06T02:00:00Z')) === '2026-10-05', 'Monday evening Pacific is Tuesday UTC');
  assert(pacificDate(new Date('2026-10-06T08:00:00Z')) === '2026-10-06', 'Tuesday 1 AM Pacific');
});
