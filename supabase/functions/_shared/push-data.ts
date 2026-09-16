// Push `data` contract shared by every notification producer.
//
// The app routes a tap purely from `data.kind` (see src/lib/pushRouting.ts).
// Producers build payloads here so a new kind cannot ship without the client
// side of the contract, and so ids are only ever attached under fixed keys.

export type PushTab = "today" | "support" | "boundaries" | "tracker" | "learn";

export type PushData =
  | { kind: "coach_message"; thread_id?: string }
  | { kind: "member_message"; thread_id?: string }
  | { kind: "session_reminder"; session_id?: string; room_name?: string }
  | { kind: "morning_note"; screen: PushTab }
  | { kind: "daily_nudge"; screen: PushTab }
  | { kind: "winback" }
  | { kind: "family_backup"; wavering_event_id?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

export function coachMessageData(threadId: unknown): PushData {
  return { kind: "coach_message", ...(uuidOrUndefined(threadId) ? { thread_id: uuidOrUndefined(threadId) } : {}) };
}

export function memberMessageData(threadId: unknown): PushData {
  return { kind: "member_message", ...(uuidOrUndefined(threadId) ? { thread_id: uuidOrUndefined(threadId) } : {}) };
}

export function sessionReminderData(sessionId: unknown): PushData {
  return { kind: "session_reminder", ...(uuidOrUndefined(sessionId) ? { session_id: uuidOrUndefined(sessionId) } : {}) };
}

export function morningNoteData(screen: PushTab): PushData {
  return { kind: "morning_note", screen };
}

export function dailyNudgeData(screen: PushTab): PushData {
  return { kind: "daily_nudge", screen };
}

export function winbackData(): PushData {
  return { kind: "winback" };
}

export function familyBackupData(waveringEventId: unknown): PushData {
  const id = uuidOrUndefined(waveringEventId);
  return { kind: "family_backup", ...(id ? { wavering_event_id: id } : {}) };
}
