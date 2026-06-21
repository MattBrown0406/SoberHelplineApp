/**
 * Situation model — the family's current readiness band and the funnel "door"
 * we should offer next. Bands come from the my_situation() RPC; the door mapping
 * lives here so UI and notifications agree on the next step.
 *
 * Funnel ladder: free Monday call → $150 coaching → plan an intervention.
 * Safety (988/911) is never a door — it is always present and never gated.
 */

export type SituationBand = 'calm' | 'watch' | 'elevated' | 'crisis';

export interface SituationDrivers {
  low_mood_days: number;
  avg_mood: number | null;
  warning_signs: number;
  recovery_signs: number;
  net_warnings: number;
  loved_one_status: string | null;
}

export interface Situation {
  score: number;
  band: SituationBand;
  sustained: boolean;
  drivers: SituationDrivers;
}

/** The next funnel step we surface for a given situation. */
export type FunnelDoor = 'free_call' | 'coaching' | 'intervention';

export const DEFAULT_SITUATION: Situation = {
  score: 0,
  band: 'calm',
  sustained: false,
  drivers: {
    low_mood_days: 0,
    avg_mood: null,
    warning_signs: 0,
    recovery_signs: 0,
    net_warnings: 0,
    loved_one_status: null,
  },
};

/**
 * Map a situation to the next funnel door.
 *  calm / watch        → free Monday call (low-pressure anchor)
 *  elevated            → $150 coaching session
 *  crisis              → coaching
 *  crisis + sustained  → warm intervention-planning offer
 *
 * Every door is an *offer*, never a gate — crisis lines stay primary upstream.
 */
export function funnelDoor(situation: Situation): FunnelDoor {
  if (situation.band === 'crisis' && situation.sustained) return 'intervention';
  if (situation.band === 'crisis' || situation.band === 'elevated') return 'coaching';
  return 'free_call';
}

/** i18n key (namespace `today`) for each door's CTA copy. */
export const DOOR_COPY_KEY: Record<FunnelDoor, string> = {
  free_call: 'situationCta.freeCall',
  coaching: 'situationCta.coaching',
  intervention: 'situationCta.intervention',
};

/** Where each door's CTA routes. free_call stays on Today (the anchor card). */
export const DOOR_ROUTE: Record<FunnelDoor, string | null> = {
  free_call: null,
  coaching: '/book-coaching',
  // P1.4 repoints this to '/plan-intervention'; until then the warm next step
  // is the same 1:1 booking with Matt.
  intervention: '/book-coaching',
};
