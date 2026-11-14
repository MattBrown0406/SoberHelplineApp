import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/** A coaching session the member booked on soberhelpline.com (see the website-coaching-sessions function). */
export interface WebsiteCoachingSession {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'completed';
  kind: 'coaching' | 'intensive';
  provider_name: string;
  join_url: string | null;
}

/**
 * Sessions booked on the website under the member's verified email, so they
 * appear in "My sessions" next to the app's own requests. The website is the
 * record; nothing is stored here. If it can't be reached the list is simply
 * empty: it must never hide or break the app's own sessions.
 */
export function useWebsiteCoachingSessions(accountId: string | undefined) {
  const [sessions, setSessions] = useState<WebsiteCoachingSession[]>([]);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    if (!accountId) return;
    try {
      const { data, error } = await supabase.functions.invoke('website-coaching-sessions');
      if (error || current !== request.current) return;
      const list = (data as { sessions?: unknown } | null)?.sessions;
      setSessions(Array.isArray(list) ? (list as WebsiteCoachingSession[]) : []);
    } catch {
      // Leave whatever is showing.
    }
  }, [accountId]);

  useEffect(() => {
    setSessions([]);
    void load();
    return () => {
      ++request.current;
    };
  }, [load]);

  return { sessions, reload: load };
}
