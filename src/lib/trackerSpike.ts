/**
 * When a warning-sign spike on the tracker raises the loved one's status to
 * 'escalating'.
 *
 * Only a spike the member makes now — the week's count rising to the threshold
 * after the tracker has loaded — escalates. Signs already logged when the
 * tracker loads were acted on when they were logged; raising them again on
 * every visit would undo a later "in treatment" or "recovery" update from the
 * Today pathway card (status must be able to come back down).
 */
export type TrackerSpikeMemory = {
  /** The count has been below the threshold since the tracker loaded. */
  seenBelow: boolean;
  /** This spike has been handled (escalated, or found already in place). */
  handled: boolean;
};

export type TrackerSpikeAction = 'none' | 'escalate' | 'refresh';

export const INITIAL_TRACKER_SPIKE_MEMORY: TrackerSpikeMemory = Object.freeze({ seenBelow: false, handled: false });

const RAISED_STATUSES = new Set(['escalating', 'crisis']);

/** Call only once the week's signs and the situation have loaded. */
export function nextTrackerSpike(
  memory: TrackerSpikeMemory,
  warnCount: number,
  threshold: number,
  currentStatus: string | null | undefined,
): { memory: TrackerSpikeMemory; action: TrackerSpikeAction } {
  if (warnCount < threshold) return { memory: { seenBelow: true, handled: false }, action: 'none' };
  if (memory.handled) return { memory, action: 'none' };
  // Already over the threshold when the tracker loaded: not a new spike.
  if (!memory.seenBelow) return { memory: { seenBelow: false, handled: true }, action: 'none' };
  return {
    memory: { seenBelow: true, handled: true },
    action: RAISED_STATUSES.has(currentStatus ?? '') ? 'refresh' : 'escalate',
  };
}
