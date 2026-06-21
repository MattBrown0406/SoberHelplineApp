import { supabase } from './supabase';

/**
 * Funnel stages logged client-side to funnel_events. `rsvp` and
 * `coaching_requested` already have source-of-truth tables (session_rsvps,
 * coaching_bookings), so instrumentation focuses on the gap stages:
 * `attended`, `intervention_viewed`, `intervention_started`.
 */
export type FunnelStage =
  | 'rsvp'
  | 'attended'
  | 'coaching_requested'
  | 'intervention_viewed'
  | 'intervention_started';

/**
 * Fire-and-forget funnel event. Never throws — analytics must not break a flow.
 * No-ops server-side when the caller isn't authenticated.
 */
export function logFunnelEvent(stage: FunnelStage, metadata?: Record<string, unknown>): void {
  void supabase
    .rpc('log_funnel_event', { p_stage: stage, p_metadata: metadata ?? {} })
    .then(({ error }) => {
      if (error) console.warn('[funnel] log failed:', stage, error.message);
    });
}
