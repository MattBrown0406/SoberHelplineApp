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

/** Sends one event; resolves when the server has answered. Never rejects. */
function sendFunnelEvent(stage: FunnelStage, metadata?: Record<string, unknown>): Promise<void> {
  try {
    return Promise.resolve(supabase.rpc('log_funnel_event', { p_stage: stage, p_metadata: metadata ?? {} }))
      .then(({ error }) => {
        if (error) console.warn('[funnel] log failed:', stage, error.message);
      })
      .catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Fire-and-forget funnel event. Never throws — analytics must not break a flow.
 * No-ops server-side when the caller isn't authenticated.
 */
export function logFunnelEvent(stage: FunnelStage, metadata?: Record<string, unknown>): void {
  void sendFunnelEvent(stage, metadata);
}

/** The longest a Join waits for its event before opening the meeting anyway. */
export const FUNNEL_SEND_WAIT_MS = 800;

/**
 * For the moment just before the app hands over to another app (a Join opens
 * Zoom): an event fired after that is sent as the app goes to the background
 * and can be lost. This one is sent first and waited for, but never for longer
 * than `waitMs`, so a slow network does not noticeably delay joining (the
 * request carries on by itself after that). Never throws.
 */
export function logFunnelEventAndWait(
  stage: FunnelStage,
  metadata?: Record<string, unknown>,
  waitMs: number = FUNNEL_SEND_WAIT_MS,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    void sendFunnelEvent(stage, metadata).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * A step on the membership path. Only a known source label and the tier are
 * sent, whatever the caller passes (the server enforces the same).
 */
export function logMembershipPath(stage: MembershipPathStage, input: { source?: unknown; tier?: unknown }): void {
  logFunnelEvent(stage, membershipPathMetadata(input));
}
