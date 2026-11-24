/**
 * Today's one "next step" slot. Five cards used to stack under the check-in;
 * now the first one that has something to show takes the slot and the others
 * wait under "More for you". Each card still decides for itself whether it
 * shows: this only picks between the ones that do. Pure, so tests pin it.
 *
 * 4.4: the old starting-point panel ("what's your situation", a 4-step
 * journey kept on the device) is gone from Today. When nothing else has a
 * step for her, the slot shows her path's next step: the step for the loved
 * one's phase, the same one "Your path" (under "More for you") offers.
 */
export const NEXT_STEP_PRIORITY = [
  'willingnessWindow',
  'lovedOneCheck',
  'holidayPlan',
  'invitation',
  'pathStep',
] as const;

export type NextStepCard = typeof NEXT_STEP_PRIORITY[number];

/** The card that always has something to show, so it is the slot's last resort. */
export const NEXT_STEP_FALLBACK: NextStepCard = 'pathStep';

/**
 * How long the always-there fallback waits for the cards above it to load
 * before it takes the slot, so a card that is a moment late does not swap in
 * under her thumb.
 */
export const NEXT_STEP_FALLBACK_WAIT_MS = 1500;

export interface NextStepChoice {
  /** The one card in the slot, or null while nothing has anything to show. */
  slot: NextStepCard | null;
  /**
   * The other cards with something to show, in priority order (empty until
   * the slot is decided). Never the fallback: outside the slot, her path's
   * step is already on "Your path" under "More for you", so it is not listed twice.
   */
  more: NextStepCard[];
}

export function chooseNextStep(
  showing: Partial<Record<NextStepCard, boolean>>,
  options: { fallbackReady?: boolean } = {},
): NextStepChoice {
  const fallbackReady = options.fallbackReady ?? true;
  const visible = NEXT_STEP_PRIORITY.filter((card) => showing[card] === true);
  const slot = visible.find((card) => card !== NEXT_STEP_FALLBACK || fallbackReady) ?? null;
  // Until a card holds the slot, nothing is listed under "More for you".
  return {
    slot,
    more: slot === null ? [] : visible.filter((card) => card !== slot && card !== NEXT_STEP_FALLBACK),
  };
}
