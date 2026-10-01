/**
 * Invitation Engine — every server call in one place. All writes go through
 * validated SECURITY DEFINER RPCs; reads are owner-only under RLS.
 */
import { supabase } from './supabase';
import { parseEngineSnapshot, type EngineSnapshot } from './invitationEngine';
import type { Forecast, QuickCheck } from './invitationForecast';
import {
  parseLearningRows,
  parseProgressAttempts,
  parseProgressForecasts,
  type InvitationOutcome,
  type LearningAttempt,
  type LineStyleChoice,
  type ProgressAttempt,
  type ProgressForecast,
} from './invitationOutcomes';
import { profileFromRow, profileToPayload, type LovedOneProfile } from './lovedOneProfile';
import type { LineStyle } from './invitationLines';
import { SCREENED_FIELDS, type ScreenedField } from './invitationScreen';

export async function fetchEngineSnapshot(localDate: string): Promise<EngineSnapshot> {
  const { data, error } = await supabase.rpc('my_invitation_engine', { p_local_date: localDate });
  if (error) throw error;
  const snapshot = parseEngineSnapshot(data);
  if (!snapshot) throw new Error('invitation_snapshot_invalid');
  return snapshot;
}

export async function fetchLovedOneProfile(accountId: string): Promise<LovedOneProfile | null> {
  const { data, error } = await supabase
    .from('loved_one_profiles')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return profileFromRow(data);
}

/** The member's own safety answer ('' when she has no pattern map yet). */
export async function fetchOwnSafetyConcern(accountId: string): Promise<string> {
  const { data, error } = await supabase
    .from('loved_one_profiles')
    .select('safety_concern')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  const concern = (data as { safety_concern?: unknown } | null)?.safety_concern;
  return typeof concern === 'string' ? concern : '';
}

export async function saveLovedOneProfile(profile: LovedOneProfile, complete: boolean): Promise<LovedOneProfile> {
  const { data, error } = await supabase.rpc('save_loved_one_profile', {
    p_profile: profileToPayload(profile),
    p_complete: complete,
  });
  if (error) throw error;
  const saved = profileFromRow(Array.isArray(data) ? data[0] : data);
  if (!saved) throw new Error('profile_not_saved');
  return saved;
}

export async function setMoveDone(moveId: string, localDate: string, done: boolean): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_invitation_move_done', {
    p_move_id: moveId,
    p_local_date: localDate,
    p_done: done,
  });
  if (error) throw error;
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : [];
}

export async function setQuickCheck(localDate: string, mood: QuickCheck | null): Promise<QuickCheck | null> {
  const { data, error } = await supabase.rpc('set_invitation_check', { p_local_date: localDate, p_mood: mood });
  if (error) throw error;
  return data === 'calm' || data === 'okay' || data === 'rough' ? data : null;
}

export async function setWindowPush(enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_invitation_window_push', { p_enabled: enabled });
  if (error) throw error;
  return data === true;
}

export async function completeInvitationSetup(windowPush: boolean): Promise<void> {
  const { error } = await supabase.rpc('complete_invitation_setup', { p_window_push: windowPush });
  if (error) throw error;
}

export async function recordForecast(localDate: string, forecast: Forecast): Promise<void> {
  const { error } = await supabase.rpc('record_invitation_forecast', {
    p_local_date: localDate,
    p_level: forecast.level,
    p_score: forecast.score,
    p_sources: forecast.sources,
  });
  if (error) throw error;
}

export type AttemptInput = {
  outcome: InvitationOutcome;
  localDate: string;
  note: string;
  forecast: Forecast | null;
  lineStyle: LineStyleChoice | null;
  nextWindowDate: string | null;
};

export type LoggedAttempt = {
  id: string;
  nextWindowDate: string | null;
  /** Whether an admin alert exists for this yes (false when none could be queued). */
  coachAlerted: boolean;
};

export async function logInvitationAttempt(input: AttemptInput): Promise<LoggedAttempt> {
  const { data, error } = await supabase.rpc('log_invitation_attempt', {
    p_outcome: input.outcome,
    p_local_date: input.localDate,
    p_note: input.note.trim() || null,
    p_forecast_level: input.forecast?.level ?? null,
    p_window_sources: input.forecast?.sources ?? [],
    p_line_style: input.lineStyle,
    p_next_window_date: input.nextWindowDate,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { id?: unknown; next_window_date?: unknown; coach_alerted?: unknown } | null;
  if (!row || typeof row.id !== 'string') throw new Error('attempt_not_saved');
  return {
    id: row.id,
    nextWindowDate: typeof row.next_window_date === 'string' ? row.next_window_date : null,
    coachAlerted: row.coach_alerted === true,
  };
}

export async function fetchLearning(): Promise<LearningAttempt[]> {
  const { data, error } = await supabase.rpc('invitation_learning');
  if (error) throw error;
  return parseLearningRows(data);
}

export type ProgressData = {
  attempts: ProgressAttempt[];
  forecasts: ProgressForecast[];
  moveDates: string[];
};

export async function fetchProgress(accountId: string): Promise<ProgressData> {
  const [attempts, forecasts, moves] = await Promise.all([
    supabase
      .from('invitation_attempts')
      .select('outcome, note, local_date, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('invitation_forecasts')
      .select('local_date, level, pushed_at')
      .eq('account_id', accountId)
      .order('local_date', { ascending: false })
      .limit(28),
    supabase
      .from('invitation_move_logs')
      .select('local_date')
      .eq('account_id', accountId)
      .order('local_date', { ascending: false })
      .limit(500),
  ]);
  const failed = attempts.error ?? forecasts.error ?? moves.error;
  if (failed) throw failed;
  return {
    attempts: parseProgressAttempts(attempts.data),
    forecasts: parseProgressForecasts(forecasts.data),
    moveDates: ((moves.data ?? []) as Array<{ local_date?: unknown }>)
      .map((row) => row.local_date)
      .filter((date): date is string => typeof date === 'string'),
  };
}

/** Warning signs the member logged in the tracker this week and last. */
export async function fetchRecentWarningSigns(accountId: string, sinceWeek: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('tracker_logs')
    .select('sign_key')
    .eq('account_id', accountId)
    .eq('kind', 'warning')
    .gte('week', sinceWeek);
  if (error) throw error;
  return [...new Set(((data ?? []) as Array<{ sign_key?: unknown }>)
    .map((row) => row.sign_key)
    .filter((key): key is string => typeof key === 'string'))];
}

export type DraftResult =
  | { ok: true; lines: Array<{ style: LineStyle; text: string }> }
  /**
   * `field` names the free text that tripped the server's crisis screen;
   * `source` says which screen ('patterns' or 'moderation'); either can be
   * set aside by her "I'm safe right now" (acknowledgedCrisis).
   */
  | { ok: false; code: string; field?: ScreenedField; source?: 'patterns' | 'moderation' };

type FunctionErrorInfo = { code: string; field?: ScreenedField; source?: 'patterns' | 'moderation' };

async function functionError(fnError: unknown): Promise<FunctionErrorInfo> {
  try {
    const ctx = (fnError as { context?: Response })?.context;
    if (ctx && typeof ctx.clone === 'function') {
      const body = await ctx.clone().json();
      if (body?.code) {
        const field = (SCREENED_FIELDS as readonly string[]).includes(body.field) ? body.field as ScreenedField : undefined;
        const source = body.source === 'moderation' || body.source === 'patterns' ? body.source as 'patterns' | 'moderation' : undefined;
        return { code: String(body.code), ...(field ? { field } : {}), ...(source ? { source } : {}) };
      }
      return { code: `http_${ctx.status}` };
    }
  } catch {
    // fall through
  }
  return { code: 'network' };
}

/** Ask invitation-coach for three lines; any failure returns a code instead. */
export async function draftInvitationLines(input: {
  language: string;
  observation: string;
  nextStep: string;
  /** She chose "I'm safe right now" for the crisis hits on screen this visit. */
  acknowledgedCrisis?: boolean;
  /**
   * The observation / next step on screen when she tapped it. The server
   * still screens either one if it has changed since.
   */
  acknowledgedObservation?: string;
  acknowledgedNextStep?: string;
}): Promise<DraftResult> {
  try {
    const { data, error } = await supabase.functions.invoke('invitation-coach', {
      body: {
        language: input.language.startsWith('es') ? 'es' : 'en',
        observation: input.observation,
        nextStep: input.nextStep,
        acknowledgedCrisis: input.acknowledgedCrisis === true,
        acknowledgedObservation: input.acknowledgedCrisis === true ? input.acknowledgedObservation ?? '' : '',
        acknowledgedNextStep: input.acknowledgedCrisis === true ? input.acknowledgedNextStep ?? '' : '',
      },
    });
    if (error) return { ok: false, ...(await functionError(error)) };
    const lines = Array.isArray(data?.lines)
      ? (data.lines as Array<{ style?: unknown; text?: unknown }>).flatMap((line): Array<{ style: LineStyle; text: string }> => {
        const style = line.style;
        return (style === 'warm' || style === 'observation' || style === 'help') && typeof line.text === 'string'
          ? [{ style, text: line.text }]
          : [];
      })
      : [];
    return lines.length ? { ok: true, lines } : { ok: false, code: 'ai_invalid' };
  } catch {
    return { ok: false, code: 'network' };
  }
}

export async function fetchAdminInvitationStats(): Promise<unknown> {
  const { data, error } = await supabase.rpc('admin_invitation_stats');
  if (error) throw error;
  return data;
}
