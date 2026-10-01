/**
 * "Redo from here": the debrief pins each thing-to-tighten to the user turn it
 * quotes; the member can rewind the conversation to just before that line and
 * take the moment again with the partner exactly where it was.
 */

type Role = 'user' | 'partner';

export function userTurnTexts(messages: readonly { role: Role; text: string }[]): string[] {
  return messages.filter((m) => m.role === 'user').map((m) => m.text);
}

/**
 * Everything said before the `userTurnIndex`-th user line (0-based) — the
 * partner's state at that moment. Null when the index doesn't exist.
 */
export function transcriptBeforeUserTurn<T extends { role: Role }>(messages: readonly T[], userTurnIndex: number): T[] | null {
  if (!Number.isInteger(userTurnIndex) || userTurnIndex < 0) return null;
  let seen = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue;
    if (seen === userTurnIndex) return messages.slice(0, i);
    seen += 1;
  }
  return null;
}

/**
 * The validated turn for workOn item `i`, or null. Debriefs saved before turn
 * pinning existed have no `workOnTurns` at all — that is simply "no redo".
 */
export function workOnTurnFor(debrief: { workOnTurns?: unknown }, i: number, userTurnCount: number): number | null {
  const turns = debrief.workOnTurns;
  if (!Array.isArray(turns)) return null;
  const value = turns[i];
  return Number.isInteger(value) && value >= 0 && value < userTurnCount ? (value as number) : null;
}
