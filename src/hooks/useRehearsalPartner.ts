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
  scores: { love: number; ask: number; boundaries: number; calm: number };
};

/** Hard cap on user turns per session — keeps sessions focused and costs bounded. */
export const MAX_USER_TURNS = 12;

type InvokeResult =
  | { ok: true; text: string; breakCharacter?: boolean; audio?: string | null }
  | { ok: true; debrief: PartnerDebrief }
  | { ok: false; code: string };

/**
 * supabase.functions.invoke returns `data: null` on any non-2xx response, so
 * the server's error code never reaches us through `data`. Dig it out of the
 * FunctionsHttpError context instead.
 */
async function extractErrorCode(fnError: unknown): Promise<string> {
  try {
    const ctx = (fnError as { context?: Response })?.context;
    if (ctx && typeof ctx.clone === 'function') {
      const body = await ctx.clone().json();
      if (body?.code) return String(body.code);
      return `http_${ctx.status}`;
    }
  } catch {
    // fall through
  }
  return 'network';
}

const TRANSIENT = new Set(['network', 'model_error', 'http_500', 'http_502', 'http_503', 'http_504']);

/**
 * Invoke the edge function with two safety nets:
 * - a stale login (401) refreshes the session and retries once
 * - a transient failure (network blip, upstream model error) retries once
 */
async function invokeRehearsal(body: Record<string, unknown>): Promise<InvokeResult> {
  let lastCode = 'network';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rehearsal-partner', { body });
      const result = data as InvokeResult | null;
      if (!fnError && result) return result;
      lastCode = fnError ? await extractErrorCode(fnError) : 'network';
    } catch {
      lastCode = 'network';
    }
    if (attempt === 0) {
      if (lastCode === 'unauthorized' || lastCode === 'http_401') {
        await supabase.auth.refreshSession().catch(() => {});
        continue;
      }
      if (TRANSIENT.has(lastCode)) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
    }
    break;
  }
  return { ok: false, code: lastCode };
}

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

  /**
   * Send a user line. Resolves {ok, audio} — on failure the optimistic
   * message is rolled back and the caller should restore the user's draft
   * so their words are never lost.
   */
  const send = useCallback(async (text: string): Promise<{ ok: boolean; audio: string | null }> => {
    const trimmed = text.trim();
    if (!trimmed || sending) return { ok: false, audio: null };
    setError(null);
    // Strip audio payloads from history sent to the server — text only.
    const history = [...messages.map(({ role, text: t }) => ({ role, text: t })), { role: 'user' as const, text: trimmed }];
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setSending(true);
    try {
      const result = await invokeRehearsal({ mode: 'reply', scenario: scenarioRef.current, messages: history });
      if (result.ok === false) {
        setError(result.code);
        setMessages(messages); // roll back the optimistic user message so they can retry
        return { ok: false, audio: null };
      }
      if ('text' in result) {
        const audio = result.audio ?? null;
        setMessages((prev) => [...prev, { role: 'partner', text: result.text, audio }]);
        if (result.breakCharacter) setSafetyBreak(true);
        return { ok: true, audio };
      }
      return { ok: true, audio: null };
    } catch {
      setError('network');
      setMessages(messages);
      return { ok: false, audio: null };
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
      const result = await invokeRehearsal({ mode: 'stt', scenario: scenarioRef.current, audio: audioB64, format });
      if (result.ok === false || !('text' in result)) {
        setError(result.ok === false ? result.code : 'network');
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
      const result = await invokeRehearsal({ mode: 'debrief', scenario: scenarioRef.current, messages: history });
      if (result.ok === false || !('debrief' in result)) {
        setError(result.ok === false ? result.code : 'network');
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
