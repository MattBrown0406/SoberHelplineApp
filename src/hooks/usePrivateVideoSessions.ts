import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { privateVideoChannelTopic } from '../lib/realtimeTopics';
import { videoErrorCode } from '../lib/videoErrors';

export type PrivateVideoStatus = 'requested' | 'scheduled' | 'live' | 'completed' | 'cancelled' | 'no_show';

export type PrivateVideoSession = {
  id: string;
  account_id: string;
  room_name: string;
  status: PrivateVideoStatus;
  requested_start: string;
  requested_timezone: string;
  duration_minutes: number;
  member_note: string | null;
  assigned_coach_id: string | null;
  version: number;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  booking_purpose: 'general_support' | 'plan_review' | 'boundaries' | 'treatment_options' | 'family_alignment' | 'crisis_follow_up';
  member_tier_at_booking: 'essential' | 'premier' | 'organization';
  appointment_type: 'membership_included' | 'one_off_150';
  payment_status: 'included' | 'pending_payment' | 'paid' | 'refunded';
  focus_reason: string | null;
  member_questions: string[];
  selected_plan_sections: string[];
  plan_snapshot_hash: string | null;
  snapshot_created_at: string | null;
  update_requested_at: string | null;
};

export type VideoSessionProposal = {
  id: string;
  session_id: string;
  proposed_by_role: 'member' | 'coach';
  starts_at: string;
  timezone: string;
  duration_minutes: number;
  note: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'superseded';
  created_at: string;
};

export type SessionRequestInput = {
  startsAt: Date;
  timezone: string;
  durationMinutes?: number;
  note?: string;
};

function errorCode(error: { message: string; code?: string } | null): string | null {
  // Network failures have code '' — never a translation key or raw message.
  return videoErrorCode(error);
}

const CHECKOUT_CODES = ['bridge_not_configured', 'checkout_not_available', 'already_paid', 'checkout_unavailable', 'account_not_found', 'premier_not_active', 'not_authenticated', 'invalid_session'];

/**
 * functions.invoke returns `data: null` for any non-2xx answer; the function's
 * own `{ code }` is only on the error's Response. Read it so the card shows
 * the specific reason instead of a generic failure.
 */
async function checkoutCode(data: unknown, error: unknown): Promise<string> {
  const fromData = (data as { code?: unknown } | null)?.code;
  if (typeof fromData === 'string' && CHECKOUT_CODES.includes(fromData)) return fromData;
  const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const body = (await (context?.clone ? context.clone().json() : context?.json?.())) as { code?: unknown } | undefined;
    if (typeof body?.code === 'string' && CHECKOUT_CODES.includes(body.code)) return body.code;
  } catch {
    // Not a JSON response (network failure); fall through.
  }
  return 'checkout_unavailable';
}

export function usePrivateVideoSessions(accountId: string | null, canAccess: boolean) {
  // Support remains mounted underneath pushed screens. A unique topic prevents
  // Supabase/Phoenix from evicting the existing subscription as a duplicate.
  const [channelInstanceId] = useState(() => Math.random().toString(36).slice(2));
  const [activeSession, setActiveSession] = useState<PrivateVideoSession | null>(null);
  const [history, setHistory] = useState<PrivateVideoSession[]>([]);
  const [pendingProposal, setPendingProposal] = useState<VideoSessionProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Set when the server made a pending one-off review included with Premier.
  const [planReviewIncluded, setPlanReviewIncluded] = useState(false);
  const loadGeneration = useRef(0);

  const clearError = useCallback(() => { setError(null); setErrorKey(null); }, []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!accountId || !canAccess) {
      setActiveSession(null); setHistory([]); setPendingProposal(null); setLoading(false); clearError();
      return;
    }
    setLoading(true);
    const [{ data: activeData, error: activeError }, { data: historyData, error: historyError }] = await Promise.all([
      supabase.rpc('member_get_active_video_session'),
      supabase.rpc('member_get_video_session_history', { p_limit: 10, p_before: null, p_before_id: null }),
    ]);
    if (generation !== loadGeneration.current) return;
    const failure = activeError ?? historyError;
    if (failure) {
      setError(failure.message); setErrorKey(errorCode(failure));
    } else {
      const active = ((activeData ?? [])[0] ?? null) as PrivateVideoSession | null;
      setActiveSession(active);
      setHistory((historyData ?? []) as PrivateVideoSession[]);
      clearError();
      if (active) {
        const { data, error: proposalError } = await supabase
          .from('video_session_proposals')
          .select('id, session_id, proposed_by_role, starts_at, timezone, duration_minutes, note, status, created_at')
          .eq('session_id', active.id).eq('status', 'pending').maybeSingle();
        if (generation !== loadGeneration.current) return;
        if (proposalError) {
          setError(proposalError.message); setErrorKey(errorCode(proposalError));
        } else setPendingProposal((data as VideoSessionProposal | null) ?? null);
      } else setPendingProposal(null);
    }
    if (generation === loadGeneration.current) setLoading(false);
  }, [accountId, canAccess, clearError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!accountId || !canAccess) return;
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    const channel = supabase.channel(privateVideoChannelTopic(accountId, channelInstanceId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_sessions', filter: `account_id=eq.${accountId}` }, () => void load())
      .subscribe();
    return () => { appState.remove(); void supabase.removeChannel(channel); };
  }, [accountId, canAccess, channelInstanceId, load]);

  const runMutation = useCallback(async (rpc: string, args: Record<string, unknown>) => {
    if (!accountId || !canAccess) return null;
    setMutating(true); clearError();
    const { data, error: rpcError } = await supabase.rpc(rpc as never, args as never);
    setMutating(false);
    if (rpcError) {
      setError(rpcError.message); setErrorKey(errorCode(rpcError));
      if (errorCode(rpcError) === 'version_conflict') await load();
      return null;
    }
    await load();
    return data as PrivateVideoSession;
  }, [accountId, canAccess, clearError, load]);

  const requestSession = useCallback((input: SessionRequestInput) => runMutation('request_private_video_session', {
    p_starts_at: input.startsAt.toISOString(), p_timezone: input.timezone,
    p_duration_minutes: input.durationMinutes ?? 60, p_note: input.note?.trim() || null,
  }), [runMutation]);

  const requestPlanReview = useCallback((input: SessionRequestInput & {
    purpose: 'plan_review'; focusReason?: string; questions: string[]; selectedSections: string[];
    snapshot: Record<string, unknown>; consentText: string; consentLocale: 'en' | 'es'; paymentChoice: 'membership_included' | 'one_off_150';
  }) => runMutation('request_plan_review_video_session', {
    p_starts_at: input.startsAt.toISOString(), p_timezone: input.timezone,
    p_duration_minutes: input.durationMinutes ?? 60, p_purpose: input.purpose,
    p_focus_reason: input.focusReason?.trim() || null,
    p_questions: input.questions.map((question) => question.trim()).filter(Boolean),
    p_selected_sections: input.selectedSections, p_snapshot: input.snapshot,
    p_consent_text: input.consentText, p_consent_locale: input.consentLocale,
    p_payment_choice: input.paymentChoice,
  }), [runMutation]);

  const submitPlanReviewRevision = useCallback((session: PrivateVideoSession, input: {
    selectedSections: string[]; snapshot: Record<string, unknown>; consentText: string; consentLocale: 'en' | 'es';
  }) => runMutation('member_submit_plan_review_revision', {
    p_session_id: session.id, p_selected_sections: input.selectedSections, p_snapshot: input.snapshot,
    p_consent_text: input.consentText, p_consent_locale: input.consentLocale,
  }), [runMutation]);

  const invokePlanReviewCheckout = useCallback(async (session: PrivateVideoSession, intent: 'checkout' | 'apply_membership'): Promise<string | null> => {
    if (!accountId || !canAccess) return null;
    setMutating(true); clearError(); setPlanReviewIncluded(false);
    const { data, error: functionError } = await supabase.functions.invoke('create-plan-review-checkout', {
      body: { session_id: session.id, intent },
    });
    if (!functionError && data?.ok && data?.included) {
      // Premier now covers this review: no payment, and the refreshed session
      // no longer offers one.
      setPlanReviewIncluded(true);
      await load();
      setMutating(false);
      return null;
    }
    if (functionError || !data?.ok || typeof data?.checkout_url !== 'string') {
      const code = await checkoutCode(data, functionError);
      setMutating(false);
      setError(functionError?.message ?? code); setErrorKey(code);
      if (code === 'already_paid' || code === 'checkout_not_available') await load();
      return null;
    }
    setMutating(false);
    return data.checkout_url;
  }, [accountId, canAccess, clearError, load]);

  const beginPlanReviewCheckout = useCallback(
    (session: PrivateVideoSession) => invokePlanReviewCheckout(session, 'checkout'),
    [invokePlanReviewCheckout],
  );

  /** For a member who upgraded after booking: make the pending one-off included. */
  const applyPremierToPlanReview = useCallback(async (session: PrivateVideoSession): Promise<void> => {
    await invokePlanReviewCheckout(session, 'apply_membership');
  }, [invokePlanReviewCheckout]);

  const rescheduleSession = useCallback((session: PrivateVideoSession, input: SessionRequestInput) => runMutation('member_reschedule_video_session', {
    p_session_id: session.id, p_expected_version: session.version, p_starts_at: input.startsAt.toISOString(),
    p_timezone: input.timezone, p_duration_minutes: input.durationMinutes ?? 60, p_note: input.note?.trim() || null,
  }), [runMutation]);

  const acceptProposal = useCallback((session: PrivateVideoSession, proposal: VideoSessionProposal) =>
    runMutation('member_accept_video_proposal', { p_session_id: session.id, p_proposal_id: proposal.id, p_expected_version: session.version }), [runMutation]);

  const cancelSession = useCallback((session: PrivateVideoSession, reason?: string) =>
    runMutation('member_cancel_video_session', { p_session_id: session.id, p_expected_version: session.version, p_reason: reason?.trim() || null }), [runMutation]);

  return {
    sessions: [...(activeSession ? [activeSession] : []), ...history], activeSession, history, pendingProposal,
    loading, requesting: mutating, mutating, error, errorKey, clearError, load, planReviewIncluded,
    requestSession, requestPlanReview, submitPlanReviewRevision, beginPlanReviewCheckout, applyPremierToPlanReview, rescheduleSession, acceptProposal, cancelSession,
  };
}
