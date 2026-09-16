import {
  coachMessageData,
  dailyNudgeData,
  familyBackupData,
  memberMessageData,
  morningNoteData,
  sessionReminderData,
  winbackData,
} from './push-data.ts';

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const UUID = '123e4567-e89b-42d3-a456-426614174000';

Deno.test('every producer payload carries a kind the client routes on', () => {
  const payloads = [
    coachMessageData(UUID), memberMessageData(UUID), sessionReminderData(UUID), morningNoteData('today'),
    dailyNudgeData('support'), winbackData(), familyBackupData(UUID),
  ];
  assertEquals(
    payloads.map((p) => p.kind),
    ['coach_message', 'member_message', 'session_reminder', 'morning_note', 'daily_nudge', 'winback', 'family_backup'],
    'kinds',
  );
  for (const payload of payloads) {
    assertEquals('screen' in payload && !('kind' in payload), false, 'screen is never the routing key');
    assertEquals('deep_link' in payload, false, 'no deep links ride in push data');
  }
});

Deno.test('ids are attached under fixed keys and only when they are uuids', () => {
  assertEquals(coachMessageData(UUID), { kind: 'coach_message', thread_id: UUID }, 'coach thread');
  assertEquals(coachMessageData('thread-1'), { kind: 'coach_message' }, 'coach non-uuid');
  assertEquals(coachMessageData(null), { kind: 'coach_message' }, 'coach null');
  assertEquals(memberMessageData(UUID), { kind: 'member_message', thread_id: UUID }, 'member thread');
  assertEquals(sessionReminderData(UUID), { kind: 'session_reminder', session_id: UUID }, 'session');
  assertEquals(sessionReminderData(undefined), { kind: 'session_reminder' }, 'session without id');
  assertEquals(familyBackupData(UUID), { kind: 'family_backup', wavering_event_id: UUID }, 'backup');
  assertEquals(familyBackupData(42), { kind: 'family_backup' }, 'backup non-string');
});

Deno.test('tab hints are limited to the tab names the client allowlists', () => {
  assertEquals(morningNoteData('boundaries'), { kind: 'morning_note', screen: 'boundaries' }, 'morning');
  assertEquals(dailyNudgeData('today'), { kind: 'daily_nudge', screen: 'today' }, 'nudge');
});
