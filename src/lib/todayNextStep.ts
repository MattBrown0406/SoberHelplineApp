/**
 * Today's one "next step" slot. Five cards used to stack under the check-in;
 * now the first one that has something to show takes the slot and the others
 * wait under "More for this week". Each card still decides for itself whether
 * it shows: this only picks between the ones that do. Pure, so tests pin it.
 */
export const NEXT_STEP_PRIORITY = [
  'willingnessWindow',
  'lovedOneCheck',
  'holidayPlan',
  'invitation',
  'guidedStart',
] as const;

export type NextStepCard = typeof NEXT_STEP_PRIORITY[number];

/** The card that always has something to show, so it is the slot's last resort. */
export const NEXT_STEP_FALLBACK: NextStepCard = 'guidedStart';

/**
 * How long the always-there fallback waits for the cards above it to load
 * before it takes the slot, so a card that is a moment late does not swap in
 * under her thumb.
 */
export const NEXT_STEP_FALLBACK_WAIT_MS = 1500;

export interface NextStepChoice {
  /** The one card in the slot, or null while nothing has anything to show. */
  slot: NextStepCard | null;
  /** The other cards with something to show, in priority order (empty until the slot is decided). */
  more: NextStepCard[];
}

export function chooseNextStep(
  showing: Partial<Record<NextStepCard, boolean>>,
  options: { fallbackReady?: boolean } = {},
): NextStepChoice {
  const fallbackReady = options.fallbackReady ?? true;
  const visible = NEXT_STEP_PRIORITY.filter((card) => showing[card] === true);
  const slot = visible.find((card) => card !== NEXT_STEP_FALLBACK || fallbackReady) ?? null;
  // Until a card holds the slot, nothing is listed under "More for this week".
  // The only card that can be showing without the slot is the fallback while
  // it waits; listing it made the "More" toggle appear for a second and a
  // half and then vanish as that card took the slot.
  return { slot, more: slot === null ? [] : visible.filter((card) => card !== slot) };
}
