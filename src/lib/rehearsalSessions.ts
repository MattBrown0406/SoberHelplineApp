import { supabase } from './supabase';

export type RehearsalSessionRow = {
  account_id: string;
  source_id: string | null;
  scenario: Record<string, unknown>;
  transcript: { role: string; text: string }[];
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
