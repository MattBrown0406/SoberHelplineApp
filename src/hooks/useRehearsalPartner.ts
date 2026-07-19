import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type PartnerTemperament = 'guarded' | 'defensive' | 'volatile' | 'tearful';

export type PartnerScenario = {
  relationship?: string;
  name?: string;
  substances?: string[];
  temperament: PartnerTemperament;
  scriptText?: string;
  language?: string;
};

export type PartnerTurn = { role: 'user' | 'partner'; text: string };

export type PartnerDebrief = {
  wentWell: string[];
  workOn: string[];
  drill: string;
  scores: { love: number; iStatements: number; calm: number; ask: number };
};

/** Hard cap on user turns per session — keeps sessions focused and costs bounded. */
export const MAX_USER_TURNS = 12;

type InvokeResult =
  | { ok: true; text: string; breakCharacter?: boolean }
  | { ok: true; debrief: PartnerDebrief }
  | { ok: false; code: string };

export function useRehearsalPartner(scenario: PartnerScenario) {
  const [messages, setMessages] = useState<PartnerTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyBreak, setSafetyBreak] = useState(false);
  const [debrief, setDebrief] = useState<PartnerDebrief | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  // Scenario is fixed for the life of a session; keep the latest without re-creating callbacks.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const userTurns = messages.filter((m) => m.role === 'user').length;
  const turnsLeft = Math.max(0, MAX_USER_TURNS - userTurns);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    const next: PartnerTurn[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(next);
    setSending(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', {
        body: { mode: 'reply', scenario: scenarioRef.current, messages: next },
      });
      const result = data as InvokeResult | null;
      if (fnError || !result || result.ok === false) {
        setError((result && result.ok === false && result.code) || 'network');
        // Roll back the optimistic user message so they can retry.
        setMessages(messages);
        return;
      }
      if ('text' in result) {
        setMessages([...next, { role: 'partner', text: result.text }]);
        if (result.breakCharacter) setSafetyBreak(true);
      }
    } catch {
      setError('network');
      setMessages(messages);
    } finally {
      setSending(false);
    }
  }, [messages, sending]);

  const requestDebrief = useCallback(async () => {
    if (debriefLoading || messages.filter((m) => m.role === 'user').length === 0) return;
    setError(null);
    setDebriefLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', {
        body: { mode: 'debrief', scenario: scenarioRef.current, messages },
      });
      const result = data as InvokeResult | null;
      if (fnError || !result || result.ok === false || !('debrief' in result)) {
        setError((result && result.ok === false && result.code) || 'network');
        return;
      }
      setDebrief(result.debrief);
    } catch {
      setError('network');
    } finally {
      setDebriefLoading(false);
    }
  }, [messages, debriefLoading]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setSafetyBreak(false);
    setDebrief(null);
  }, []);

  return {
    messages,
    sending,
    error,
    safetyBreak,
    debrief,
    debriefLoading,
    turnsLeft,
    send,
    requestDebrief,
    reset,
  };
}
