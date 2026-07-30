import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BriefPreview, SituationBriefRow } from '../lib/situationBrief';

export type SendBriefResult =
  | { ok: true }
  | { ok: false; code: 'too_soon' | 'error' };

/**
 * Member side of the Situation Brief flow: preview what would be sent, send it,
 * and list past briefs (with Matt's read/replied status, via owner RLS).
 */
export function useSituationBrief(accountId: string | null) {
  const [preview, setPreview] = useState<BriefPreview | null>(null);
  const [briefs, setBriefs] = useState<SituationBriefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) {
      setPreview(null);
      setBriefs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [previewRes, briefsRes] = await Promise.all([
      supabase.rpc('preview_situation_brief'),
      supabase
        .from('situation_briefs')
        .select('id, band, score, sustained, note, status, created_at, read_at, replied_at')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    if (!previewRes.error && previewRes.data) {
      setPreview(previewRes.data as BriefPreview);
    }
    if (!briefsRes.error && briefsRes.data) {
      setBriefs(briefsRes.data as SituationBriefRow[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (note: string): Promise<SendBriefResult> => {
      if (!accountId || sending) return { ok: false, code: 'error' };
      setSending(true);
      const trimmed = note.trim();
      const { error } = await supabase.rpc('send_situation_brief', {
        p_note: trimmed.length > 0 ? trimmed.slice(0, 2000) : null,
      });
      setSending(false);
      if (error) {
        const tooSoon = (error.message ?? '').includes('too_soon');
        return { ok: false, code: tooSoon ? 'too_soon' : 'error' };
      }
      await load();
      return { ok: true };
    },
    [accountId, sending, load],
  );

  return { preview, briefs, loading, sending, send, refresh: load };
}
