import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type PartnerTemperament = 'guarded' | 'defensive' | 'volatile' | 'tearful';
export type PartnerGender = 'male' | 'female';
export type PartnerAge = 'young' | 'middle' | 'older';
export type PartnerRelationship =
  | 'spouse'
  | 'partner'
  | 'son'
  | 'daughter'
  | 'sibling'
  | 'parent'
  | 'friend';

export type PartnerScenario = {
  relationship?: string;
  name?: string;
  substances?: string[];
  temperament: PartnerTemperament;
  scriptText?: string;
  language?: string;
  voice?: { gender: PartnerGender; age: PartnerAge };
};

export type PartnerTurn = { role: 'user' | 'partner'; text: string; audio?: string | null };

export type PartnerDebrief = {
  wentWell: string[];
  workOn: string[];
  drill: string;
  scores: { love: number; iStatements: number; calm: number; ask: number };
};

/** Hard cap on user turns per session — keeps sessions focused and costs bounded. */
export const MAX_USER_TURNS = 12;

type InvokeResult =
  | { ok: true; text: string; breakCharacter?: boolean; audio?: string | null }
  | { ok: true; debrief: PartnerDebrief }
  | { ok: false; code: string };

export function useRehearsalPartner(scenario: PartnerScenario) {
  const [messages, setMessages] = useState<PartnerTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyBreak, setSafetyBreak] = useState(false);
  const [debrief, setDebrief] = useState<PartnerDebrief | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  // Scenario is fixed for the life of a session; keep the latest without re-creating callbacks.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const userTurns = messages.filter((m) => m.role === 'user').length;
  const turnsLeft = Math.max(0, MAX_USER_TURNS - userTurns);

  /** Send a user line; resolves with the partner's audio (base64 mp3) if voice is on. */
  const send = useCallback(async (text: string): Promise<string | null> => {
    const trimmed = text.trim();
    if (!trimmed || sending) return null;
    setError(null);
    // Strip audio payloads from history sent to the server — text only.
    const history = [...messages.map(({ role, text: t }) => ({ role, text: t })), { role: 'user' as const, text: trimmed }];
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setSending(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', {
        body: { mode: 'reply', scenario: scenarioRef.current, messages: history },
      });
      const result = data as InvokeResult | null;
      if (fnError || !result || result.ok === false) {
        setError((result && result.ok === false && result.code) || 'network');
        setMessages(messages); // roll back the optimistic user message so they can retry
        return null;
      }
      if ('text' in result) {
        const audio = result.audio ?? null;
        setMessages((prev) => [...prev, { role: 'partner', text: result.text, audio }]);
        if (result.breakCharacter) setSafetyBreak(true);
        return audio;
      }
      return null;
    } catch {
      setError('network');
      setMessages(messages);
      return null;
    } finally {
      setSending(false);
    }
  }, [messages, sending]);

  /** Transcribe a recorded clip (base64) into text the user can review before sending. */
  const transcribeClip = useCallback(async (audioB64: string, format: string): Promise<string | null> => {
    if (transcribing) return null;
    setError(null);
    setTranscribing(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', {
        body: { mode: 'stt', scenario: scenarioRef.current, audio: audioB64, format },
      });
      const result = data as InvokeResult | null;
      if (fnError || !result || result.ok === false || !('text' in result)) {
        setError((result && result.ok === false && result.code) || 'network');
        return null;
      }
      return result.text;
    } catch {
      setError('network');
      return null;
    } finally {
      setTranscribing(false);
    }
  }, [transcribing]);

  const requestDebrief = useCallback(async () => {
    if (debriefLoading || messages.filter((m) => m.role === 'user').length === 0) return;
    setError(null);
    setDebriefLoading(true);
    try {
      const history = messages.map(({ role, text }) => ({ role, text }));
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', {
        body: { mode: 'debrief', scenario: scenarioRef.current, messages: history },
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
    transcribing,
    error,
    safetyBreak,
    debrief,
    debriefLoading,
    turnsLeft,
    send,
    transcribeClip,
    requestDebrief,
    reset,
  };
}
