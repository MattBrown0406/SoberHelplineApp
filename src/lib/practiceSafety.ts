/**
 * "I'm safe — keep practicing": crisis screening is tuned for safety, so a
 * figure of speech can pause the practice. When the pause was triggered by
 * the member's own latest line, she can say she's safe and carry on. That
 * line (and the pause message after it) leaves the conversation entirely —
 * from the transcript and from everything later sent to the server — so it
 * can't re-trigger the pause on the next reply or block her coaching.
 */

type Role = 'user' | 'partner';

/**
 * The conversation to continue from, or null when keep-practicing isn't
 * offered: a pause with no member line (an incoming call's opening), or an
 * index that doesn't point at one of her lines.
 */
export function keepPracticingFrom<T extends { role: Role }>(messages: readonly T[], breakLine: number | null): T[] | null {
  if (breakLine === null || !Number.isInteger(breakLine) || breakLine < 0 || breakLine >= messages.length) return null;
  if (messages[breakLine].role !== 'user') return null;
  return messages.slice(0, breakLine);
}

/**
 * Async work started before a pause (or before she chose to keep practicing)
 * must not land afterward: every request remembers the epoch it began in.
 */
export function isStale(startedIn: number, current: number): boolean {
  return startedIn !== current;
}

/**
 * When the practice leaves the conversation (coaching appears, a call ends),
 * any live microphone and its pending draft are discarded — never uploaded,
 * never dropped into a hidden draft for the next session.
 */
export function leavesConversation<S extends string>(stage: S, conversationStage: S): boolean {
  return stage !== conversationStage;
}

/**
 * A pause that lands while coaching is on screen brings the conversation (and
 * its crisis card) back — the coaching is dropped.
 */
export function stageAfterSafetyBreak<S extends string>(stage: S, safetyBreak: boolean, coachingStage: S, conversationStage: S): S {
  return safetyBreak && stage === coachingStage ? conversationStage : stage;
}
