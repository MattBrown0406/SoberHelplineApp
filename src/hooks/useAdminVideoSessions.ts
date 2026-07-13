import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type VideoSessionStatus = 'requested' | 'scheduled' | 'live' | 'completed' | 'cancelled' | 'no_show';

export type AdminVideoSession = {
  id: string;
  account_id: string;
  room_name: string;
  status: VideoSessionStatus;
  requested_start: string;
  requested_timezone: string;
  duration_minutes: number;
  member_note: string | null;
  assigned_coach_id: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  completion_outcome: string | null;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  memberName?: string;
  pendingProposal?: VideoSessionProposal;
  booking_purpose: string;
  member_tier_at_booking: 'essential' | 'premier' | 'organization';
  appointment_type: 'membership_included' | 'one_off_150';
  payment_status: 'included' | 'pending_payment' | 'paid' | 'refunded';
  focus_reason: string | null;
  member_questions: string[];
  selected_plan_sections: string[];
  plan_snapshot: { schemaVersion: number; sections: Record<string, unknown> } | null;
  plan_snapshot_hash: string | null;
  snapshot_created_at: string | null;
  consented_at: string | null;
  admin_prep_notes: string | null;
  update_requested_at: string | null;
  update_request_note: string | null;
  latestPlanRevision?: PlanReviewRevision;
};

export type PlanReviewRevision = {
  id: string; session_id: string; revision_number: number; selected_plan_sections: string[];
  plan_snapshot: { schemaVersion: number; sections: Record<string, unknown> };
  consented_at: string; created_at: string;
};

export type VideoSessionProposal = {
  id: string;
  session_id: string;
  proposed_by_role: 'member' | 'coach';
  coach_id: string | null;
  starts_at: string;
  timezone: string;
  duration_minutes: number;
  note: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'superseded';
  created_at: string;
};

export type VideoStaff = {
  account_id: string;
  role: 'owner' | 'coach';
  active: boolean;
  name: string;
  timezone?: string;
};

type PlanReviewPrep = { session_id: string; notes: string | null; updated_at: string };

type VideoPerson = {
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  timezone: string;
};

const HISTORY_PAGE_SIZE = 20;
const terminalStatuses: VideoSessionStatus[] = ['completed', 'cancelled', 'no_show'];

function messageForError(error: { message?: string; details?: string } | null): string {
  const raw = `${error?.message ?? 'Something went wrong'} ${error?.details ?? ''}`.trim();
  if (raw.includes('coach_schedule_conflict')) return 'That coach already has a session during this time. Choose another coach or time.';
  if (raw.includes('version_conflict')) return 'This session changed on another device. The latest details have been refreshed.';
  if (raw.includes('not_assigned_coach')) return 'Only the assigned coach (or an owner) can perform that action.';
  if (raw.includes('not_authorized')) return 'You do not have permission to manage Premier video sessions.';
  return raw.replace(/_/g, ' ');
}

export function useAdminVideoSessions() {
  const [active, setActive] = useState<AdminVideoSession[]>([]);
  const [history, setHistory] = useState<AdminVideoSession[]>([]);
  const [staff, setStaff] = useState<VideoStaff[]>([]);
  const [activeLoading, setActiveLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);
  const [isVideoStaff, setIsVideoStaff] = useState(false);

  const checkAccess = useCallback(async () => {
    setAccessLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setIsVideoStaff(false);
      setAccessLoading(false);
      return false;
    }
    const { data: accountId, error: accountError } = await supabase.rpc('my_account_id');
    if (accountError || !accountId) {
      setIsVideoStaff(false);
      setAccessLoading(false);
      return false;
    }
    const { data, error } = await supabase
      .from('video_staff_roles')
      .select('account_id')
      .eq('account_id', accountId)
      .eq('active', true)
      .maybeSingle();
    const authorized = !error && Boolean(data);
    setIsVideoStaff(authorized);
    setAccessLoading(false);
    return authorized;
  }, []);

  const hydrate = useCallback(async (rows: AdminVideoSession[]) => {
    if (!rows.length) return rows;
    const sessionIds = rows.map((row) => row.id);
    const accountIds = [...new Set(rows.map((row) => row.account_id))];
    const [{ data: proposals }, { data: people, error: peopleError }, { data: prepRows, error: prepError }, { data: revisionRows, error: revisionError }] = await Promise.all([
      supabase.from('video_session_proposals').select('id,session_id,proposed_by_role,coach_id,starts_at,timezone,duration_minutes,note,status,created_at').in('session_id', sessionIds).eq('status', 'pending'),
      supabase.rpc('admin_get_video_people', { p_account_ids: accountIds }),
      supabase.rpc('admin_get_plan_review_prep', { p_session_ids: sessionIds }),
      supabase.rpc('admin_get_plan_review_revisions', { p_session_ids: sessionIds }),
    ]);
    if (peopleError) throw peopleError;
    if (prepError) throw prepError;
    if (revisionError) throw revisionError;
    const proposalBySession = new Map((proposals ?? []).map((proposal) => [proposal.session_id, proposal as VideoSessionProposal]));
    const prepBySession = new Map(((prepRows ?? []) as PlanReviewPrep[]).map((prep) => [prep.session_id, prep.notes]));
    const latestRevisionBySession = new Map<string, PlanReviewRevision>();
    for (const revision of (revisionRows ?? []) as PlanReviewRevision[]) if (!latestRevisionBySession.has(revision.session_id)) latestRevisionBySession.set(revision.session_id, revision);
    const nameByAccount = new Map(((people ?? []) as VideoPerson[]).map((person) => [person.account_id, `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim()]));
    return rows.map((row) => ({
      ...row,
      memberName: nameByAccount.get(row.account_id) || undefined,
      pendingProposal: proposalBySession.get(row.id),
      admin_prep_notes: prepBySession.get(row.id) ?? null,
      latestPlanRevision: latestRevisionBySession.get(row.id),
    }));
  }, []);

  const loadStaff = useCallback(async () => {
    const { data: roleRows } = await supabase.from('video_staff_roles').select('account_id,role,active').eq('active', true).order('role');
    if (!roleRows) return;
    const ids = roleRows.map((row) => row.account_id);
    const { data: people, error } = ids.length
      ? await supabase.rpc('admin_get_video_people', { p_account_ids: ids })
      : { data: [] as VideoPerson[], error: null };
    if (error) return;
    const names = new Map(((people ?? []) as VideoPerson[]).map((row) => [row.account_id, `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()]));
    const zones = new Map(((people ?? []) as VideoPerson[]).map((row) => [row.account_id, row.timezone]));
    setStaff(roleRows.map((row) => ({
      account_id: row.account_id,
      role: row.role as VideoStaff['role'],
      active: row.active,
      name: names.get(row.account_id) || `Staff ${row.account_id.slice(0, 8)}`,
      timezone: zones.get(row.account_id),
    })));
  }, []);

  const refreshActive = useCallback(async () => {
    setActiveLoading(true);
    setActiveError(null);
    const { data, error } = await supabase.rpc('admin_get_active_video_sessions');
    if (error) setActiveError(messageForError(error));
    else {
      try {
        setActive(await hydrate((data ?? []) as AdminVideoSession[]));
      } catch (hydrateError) {
        setActiveError(messageForError(hydrateError as { message?: string }));
      }
    }
    setActiveLoading(false);
  }, [hydrate]);

  const loadHistory = useCallback(async (reset = false) => {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    const existing = reset ? [] : history;
    const last = existing[existing.length - 1];
    const before = last ? (last.ended_at ?? last.cancelled_at ?? last.updated_at) : null;
    const { data, error } = await supabase.rpc('admin_get_video_session_history', {
      p_limit: HISTORY_PAGE_SIZE,
      p_before: before,
      p_before_id: last?.id ?? null,
    });
    if (error) setHistoryError(messageForError(error));
    else {
      try {
        const page = await hydrate((data ?? []) as AdminVideoSession[]);
        setHistory(reset ? page : [...existing, ...page]);
        setHistoryHasMore(page.length === HISTORY_PAGE_SIZE);
        setHistoryLoaded(true);
      } catch (hydrateError) {
        setHistoryError(messageForError(hydrateError as { message?: string }));
      }
    }
    setHistoryLoading(false);
  }, [history, historyLoading, hydrate]);

  useEffect(() => {
    void checkAccess().then((authorized) => {
      if (authorized) void Promise.all([refreshActive(), loadStaff()]);
      else setActiveLoading(false);
    });
  }, [checkAccess, refreshActive, loadStaff]);

  const runAction = useCallback(async (session: AdminVideoSession, rpc: string, params: Record<string, unknown> = {}) => {
    setActingId(session.id);
    setActionError(null);
    const { error } = await supabase.rpc(rpc, {
      p_session_id: session.id,
      p_expected_version: session.version,
      ...params,
    });
    if (error) setActionError(messageForError(error));
    await refreshActive();
    if (terminalStatuses.includes(session.status) || ['coach_complete_video_session', 'coach_mark_member_no_show', 'coach_mark_coach_no_show', 'coach_cancel_video_session'].includes(rpc)) {
      if (historyLoaded) await loadHistory(true);
    }
    setActingId(null);
    return !error;
  }, [historyLoaded, loadHistory, refreshActive]);

  const sections = useMemo(() => ({
    needsAction: active.filter((session) => session.status === 'requested'),
    upcoming: active.filter((session) => session.status === 'scheduled'),
    live: active.filter((session) => session.status === 'live'),
  }), [active]);

  return {
    ...sections,
    history,
    staff,
    activeLoading,
    historyLoading,
    activeError,
    historyError,
    actionError,
    actingId,
    historyLoaded,
    historyHasMore,
    accessLoading,
    isVideoStaff,
    refreshActive,
    loadHistory,
    runAction,
    clearActionError: () => setActionError(null),
  };
}

export type AdminVideoSessionsState = ReturnType<typeof useAdminVideoSessions>;
