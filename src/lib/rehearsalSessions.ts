import { supabase } from './supabase';
import type { SavedSessionRow } from './practiceTrends';

export type RehearsalSessionRow = {
  account_id: string;
  source_id: string | null;
  scenario: Record<string, unknown>;
  /** {role, text} plus, in a family rehearsal, the speaker's name on user lines. */
  transcript: { role: string; text: string; speaker?: string }[];
  debrief: unknown;
};

/**
 * Persists a finished practice session to the family's history. Postgrest
 * builders are lazy — the request only fires when awaited — so this must be
 * awaited, never `void`ed. Retries once for a transient network failure and
 * reports whether the row was saved.
 */
export async function saveRehearsalSession(row: RehearsalSessionRow): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.from('rehearsal_sessions').insert(row);
    if (!error) return true;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    else console.warn('[rehearsal] session save failed:', error.message);
  }
  return false;
}

/**
 * The member's most recent sessions (newest first), just enough to recommend
 * a difficulty level. Best-effort: an empty list simply means "no suggestion".
 */
export async function loadRecentRehearsalScores(accountId: string, limit = 12): Promise<SavedSessionRow[]> {
  try {
    const { data, error } = await supabase
      .from('rehearsal_sessions')
      .select('created_at, scenario, debrief')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data as SavedSessionRow[] | null) ?? [];
  } catch {
    return [];
  }
}
