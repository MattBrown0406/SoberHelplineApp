import { isFamilySquaresReminderHour } from './family-squares-time.ts';

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
