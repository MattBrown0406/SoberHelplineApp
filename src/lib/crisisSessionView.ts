/**
 * What Crisis Mode shows for a member's private video / plan-review session.
 *
 * A member's own active session is hers whatever her tier: a lapsed member who
 * paid for a one-off plan review (or booked one while she had Essential or
 * Premier) still sees it, can pay for it, confirm a time, and join — the
 * session RPCs and the livekit-token service admit the session owner. The
 * "plan review is part of Essential and Premier" gate appears only once we know
 * she has no active session.
 */
export type CrisisSessionViewInput = {
  hasEssential: boolean;
  canAccessPrivateVideo: boolean;
  entitlementsSettled: boolean;
  /** A session read has finished for this account (successfully or not). */
  sessionsLoaded: boolean;
  /** The last session read failed, so "no active session" is not known. */
  sessionLoadFailed: boolean;
  activeSession: { appointment_type: string; booking_purpose: string } | null;
};

export type CrisisSessionView = {
  /** The session card: status, accept/reschedule/cancel, join when live. */
  showSessionCard: boolean;
  /** The plan-review card: booking (Essential/Premier) or her existing review's payment/update status. */
  showPlanReviewCard: boolean;
  /** The upgrade gate, only for a member with no access and no active session. */
  showGate: boolean;
  /** The session read failed for a member without access: offer a retry instead of the gate. */
  showLoadError: boolean;
};

export function crisisSessionView(input: CrisisSessionViewInput): CrisisSessionView {
  const own = input.activeSession;
  const hasAccess = input.hasEssential || input.canAccessPrivateVideo;
  const knownWithoutSession = !own && input.entitlementsSettled && input.sessionsLoaded;
  return {
    showSessionCard: input.canAccessPrivateVideo || !!own,
    showPlanReviewCard: input.hasEssential || own?.booking_purpose === 'plan_review',
    showGate: !hasAccess && knownWithoutSession && !input.sessionLoadFailed,
    showLoadError: !hasAccess && knownWithoutSession && input.sessionLoadFailed,
  };
}
