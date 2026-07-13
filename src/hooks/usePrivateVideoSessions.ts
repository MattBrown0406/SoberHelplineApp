import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

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
  if (!error) return null;
  const known = ['version_conflict', 'active_session_exists', 'invalid_request', 'invalid_plan_review_request', 'invalid_plan_review_revision', 'plan_update_not_requested', 'invalid_timezone', 'proposal_not_found', 'session_not_found', 'premium_video_access_required', 'premier_upgrade_or_payment_required', 'essential_or_premier_required', 'payment_not_verified', 'invalid_transition'];
  return known.find((code) => error.message.includes(code)) ?? error.code ?? 'unknown';
}

export function usePrivateVideoSessions(accountId: string | null, canAccess: boolean) {
  const [activeSession, setActiveSession] = useState<PrivateVideoSession | null>(null);
  const [history, setHistory] = useState<PrivateVideoSession[]>([]);
  const [pendingProposal, setPendingProposal] = useState<VideoSessionProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const clearError = useCallback(() => { setError(null); setErrorKey(null); }, []);

  const load = useCallback(async () => {
    if (!accountId || !canAccess) {
      setActiveSession(null); setHistory([]); setPendingProposal(null); clearError();
      return;
    }
    setLoading(true);
    const [{ data: activeData, error: activeError }, { data: historyData, error: historyError }] = await Promise.all([
      supabase.rpc('member_get_active_video_session'),
      supabase.rpc('member_get_video_session_history', { p_limit: 10, p_before: null, p_before_id: null }),
    ]);
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
        if (proposalError) {
          setError(proposalError.message); setErrorKey(errorCode(proposalError));
        } else setPendingProposal((data as VideoSessionProposal | null) ?? null);
      } else setPendingProposal(null);
    }
    setLoading(false);
  }, [accountId, canAccess, clearError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!accountId || !canAccess) return;
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    const channel = supabase.channel(`member-video-${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'video_sessions', filter: `account_id=eq.${accountId}` }, () => void load())
      .subscribe();
    return () => { appState.remove(); void supabase.removeChannel(channel); };
  }, [accountId, canAccess, load]);

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

  const beginPlanReviewCheckout = useCallback(async (session: PrivateVideoSession): Promise<string | null> => {
    if (!accountId || !canAccess) return null;
    setMutating(true); clearError();
    const { data, error: functionError } = await supabase.functions.invoke('create-plan-review-checkout', {
      body: { session_id: session.id },
    });
    setMutating(false);
    if (functionError || !data?.ok || typeof data?.checkout_url !== 'string') {
      const message = functionError?.message ?? data?.code ?? 'checkout_unavailable';
      setError(message); setErrorKey(data?.code ?? 'checkout_unavailable'); return null;
    }
    return data.checkout_url;
  }, [accountId, canAccess, clearError]);

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
    loading, requesting: mutating, mutating, error, errorKey, clearError, load,
    requestSession, requestPlanReview, submitPlanReviewRevision, beginPlanReviewCheckout, rescheduleSession, acceptProposal, cancelSession,
  };
}
