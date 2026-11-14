import { supabase } from './supabase';
import { membershipPathMetadata, type MembershipPathStage } from './membershipPath';

/**
 * Funnel stages logged client-side to funnel_events. `rsvp` and
 * `coaching_requested` already have source-of-truth tables (session_rsvps,
 * coaching_bookings), so instrumentation focuses on the gap stages:
 * `attended` (tapped Join), `attended_10min` (stayed), `intervention_viewed`,
 * `intervention_started`. The server keeps its own allow-list (log_funnel_event).
 */
export type FunnelStage =
  | 'rsvp'
  | 'attended'
  // Came back to the app ten minutes or more after tapping Join during the meeting.
  | 'attended_10min'
  | 'coaching_requested'
  | 'intervention_viewed'
  | 'intervention_started'
  | 'brief_opened'
  | 'review_eligible'
  | 'review_prompt_requested'
  | 'review_unavailable'
  | 'review_manual_opened'
  | 'monday_call_share_requested'
  | 'boundary_card_print_requested'
  | 'tool_opened'
  | 'tool_finished'
  // The membership path (membershipPath.ts): tier and source only.
  | 'plans_viewed'
  | 'plan_sheet_opened'
  | 'purchase_started'
  | 'purchase_succeeded'
  | 'purchase_cancelled'
  | 'purchase_failed'
  | 'membership_invite_shown'
  | 'membership_invite_tapped';

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

/**
 * A step on the membership path. Only a known source label and the tier are
 * sent, whatever the caller passes (the server enforces the same).
 */
export function logMembershipPath(stage: MembershipPathStage, input: { source?: unknown; tier?: unknown }): void {
  logFunnelEvent(stage, membershipPathMetadata(input));
}
