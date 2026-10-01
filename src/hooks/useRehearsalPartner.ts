import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { PracticeProfile } from '../lib/practiceProfile';
import type { FamilySpeaker } from '../lib/practiceFamily';
import type { DeliveryReport, VoiceClip } from '../lib/practiceDelivery';
import { isStale, keepPracticingFrom } from '../lib/practiceSafety';
import type {
  CrisisPreset,
  PartnerTemperament,
  PracticeSituation,
  PracticeSource,
} from '../lib/practiceScenarios';

export type { CrisisPreset, PartnerTemperament, PracticeSituation, PracticeSource } from '../lib/practiceScenarios';
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
  /** Who the character is (age, gender) — sent even when spoken voice is off. */
  persona?: { gender: PartnerGender; age: PartnerAge };
  // incoming_call: the AI places the call and opens mid-crisis (no user turn first)
  mode?: 'standard' | 'incoming_call';
  crisisPreset?: CrisisPreset;
  /** Standard practice: the circumstance the member walks into. */
  situation?: PracticeSituation;
  /** "Use what I've told you about <name>": the family's own description. */
  profile?: PracticeProfile;
  /** Family rehearsal (2–4 speakers); user turns carry the speaker index. */
  speakers?: FamilySpeaker[];
  /** Exact words being practiced (an invitation line or the intervention letter). */
  practiceText?: string;
  practiceSource?: PracticeSource;
  warmup?: boolean;
};

export type PartnerTurn = {
  role: 'user' | 'partner';
  text: string;
  audio?: string | null;
  /** Family rehearsal: index into scenario.speakers of who said this line. */
  speaker?: number;
  /** Device-only voice stats for delivery feedback — never sent to the server. */
  clips?: VoiceClip[];
};

export type PartnerDebrief = {
  wentWell: string[];
  workOn: string[];
  /** Parallel to workOn: the 0-based user turn each item is about. Absent on older saved debriefs. */
  workOnTurns?: (number | null)[];
  drill: string;
  scores: { love: number; ask: number; boundaries: number; calm: number };
  /** Added on the device when the session is saved. */
  delivery?: DeliveryReport | null;
};

/** Which crisis the break is for; 'unknown' when the model broke character without saying. Every card shows every resource. */
export type SafetyKind = 'self_harm' | 'abuse' | 'unknown';

/** Hard cap on user turns per session — keeps sessions focused and costs bounded. */
export const MAX_USER_TURNS = 12;

/** Bound on the screening-only transcript sent with a read-aloud (the server bounds it again). */
const MAX_SCREENING_CHARS = 10_000;

type InvokeResult =
  | {
    ok: true;
    text: string;
    breakCharacter?: boolean;
    audio?: string | null;
    hint?: string | null;
    /** stt: the crisis-break message when the transcript itself was a crisis disclosure. */
    breakText?: string;
    /** Which crisis the break is for — it only orders the resources on the crisis card. */
    crisisKind?: string;
  }
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

const TRANSIENT = new Set(['network', 'model_error', 'opening_in_progress', 'http_409', 'http_500', 'http_502', 'http_503', 'http_504']);

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

/** What the server sees of a turn: text, plus who spoke in a family rehearsal. No audio, no voice stats. */
function wireTurn({ role, text, speaker }: PartnerTurn): { role: 'user' | 'partner'; text: string; speaker?: number } {
  return role === 'user' && typeof speaker === 'number' ? { role, text, speaker } : { role, text };
}

export type RehearsalPartnerOptions = {
  /** User turns allowed this session (warm-up uses 3). */
  maxUserTurns?: number;
  /** Ask for a whisper-coach hint alongside each reply. */
  whisper?: boolean;
};

export function useRehearsalPartner(
  scenario: PartnerScenario,
  practiceEventId?: string,
  options: RehearsalPartnerOptions = {},
) {
  const [messages, setMessages] = useState<PartnerTurn[]>([]);
  const messagesRef = useRef<PartnerTurn[]>([]);
  messagesRef.current = messages;
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyBreak, setSafetyBreak] = useState(false);
  const [debrief, setDebrief] = useState<PartnerDebrief | null>(null);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // Mirrors safetyBreak for async work: a reply, transcript, or debrief that
  // resolves after a crisis break must see it immediately, not on next render.
  const safetyBreakRef = useRef(false);
  const [safetyKind, setSafetyKind] = useState<SafetyKind>('unknown');
  // Which member line (index into messages) triggered the pause; null when no
  // line of hers did (an incoming call's opening, a coaching-time check).
  const breakLineRef = useRef<number | null>(null);
  const [breakLine, setBreakLine] = useState<number | null>(null);
  // Sticky for the session: once paused, a "Get help now" link stays in view.
  const [hadSafetyBreak, setHadSafetyBreak] = useState(false);
  // Every request remembers the epoch it began in; a pause, "keep practicing",
  // reset, or rewind moves to a new epoch so nothing stale lands afterward.
  const epochRef = useRef(0);
  const markSafetyBreak = useCallback((kind?: unknown, line: number | null = null) => {
    epochRef.current += 1;
    safetyBreakRef.current = true;
    breakLineRef.current = line;
    setBreakLine(line);
    setSafetyBreak(true);
    setHadSafetyBreak(true);
    setSafetyKind(kind === 'abuse' ? 'abuse' : kind === 'self_harm' ? 'self_harm' : 'unknown');
    setHint(null);
    // Coaching never stands in front of the crisis card.
    setDebrief(null);
  }, []);
  // Scenario is fixed for the life of a session; keep the latest without re-creating callbacks.
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const practiceEventIdRef = useRef(practiceEventId);
  practiceEventIdRef.current = practiceEventId;
  const whisperRef = useRef(!!options.whisper);
  whisperRef.current = !!options.whisper;

  const maxUserTurns = options.maxUserTurns ?? MAX_USER_TURNS;
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const turnsLeft = Math.max(0, maxUserTurns - userTurns);

  /**
   * Send a user line. Resolves {ok, audio} — on failure the optimistic
   * message is rolled back and the caller should restore the user's draft
   * so their words are never lost.
   */
  const send = useCallback(async (
    text: string,
    meta: {
      speaker?: number;
      clips?: VoiceClip[];
      /**
       * What was actually said when the line sent is prepared text (a letter
       * read aloud): screened for a crisis by the server, never shown to the AI.
       */
      screeningText?: string;
    } = {},
  ): Promise<{ ok: boolean; audio: string | null }> => {
    const trimmed = text.trim();
    if (!trimmed || sending || safetyBreakRef.current) return { ok: false, audio: null };
    setError(null);
    setHint(null);
    const outgoing: PartnerTurn = {
      role: 'user',
      text: trimmed,
      ...(typeof meta.speaker === 'number' ? { speaker: meta.speaker } : {}),
      ...(meta.clips?.length ? { clips: meta.clips } : {}),
    };
    // Strip audio payloads and voice stats from history sent to the server — text only.
    const history = [...messages, outgoing].map(wireTurn);
    const lineIndex = messages.length;
    const epoch = epochRef.current;
    setMessages((prev) => [...prev, outgoing]);
    setSending(true);
    try {
      const result = await invokeRehearsal({
        mode: 'reply',
        scenario: scenarioRef.current,
        messages: history,
        ...(whisperRef.current ? { whisper: true } : {}),
        ...(meta.screeningText?.trim() ? { screeningText: meta.screeningText.slice(0, MAX_SCREENING_CHARS) } : {}),
      });
      // A pause (or "keep practicing") happened while this reply was in
      // flight — e.g. a spoken clip was a disclosure: it never lands or plays.
      if (isStale(epoch, epochRef.current) || safetyBreakRef.current) {
        return { ok: true, audio: null };
      }
      if (result.ok === false) {
        setError(result.code);
        setMessages(messages); // roll back the optimistic user message so they can retry
        return { ok: false, audio: null };
      }
      if ('text' in result) {
        const audio = result.breakCharacter ? null : result.audio ?? null;
        setMessages((prev) => [...prev, { role: 'partner', text: result.text, audio }]);
        // The pause was her line's doing: she may say she's safe and keep practicing.
        if (result.breakCharacter) markSafetyBreak(result.crisisKind, lineIndex);
        else setHint(typeof result.hint === 'string' && result.hint ? result.hint : null);
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
  }, [messages, sending, markSafetyBreak]);

  /**
   * Transcribe a recorded clip (base64) into text the user can review before
   * sending. The server screens every transcript in full: a crisis disclosure
   * becomes the crisis break right here (the line and the break message join
   * the conversation, input locks) and nothing goes into the draft.
   */
  const transcribeClip = useCallback(async (
    audioB64: string,
    format: string,
    /** 'delivery': the member reading their prepared text aloud — only what they add to it is screened. */
    purpose?: 'delivery',
  ): Promise<string | null> => {
    if (transcribing || safetyBreakRef.current) return null;
    setError(null);
    setTranscribing(true);
    const epoch = epochRef.current;
    try {
      const result = await invokeRehearsal({
        mode: 'stt',
        scenario: scenarioRef.current,
        audio: audioB64,
        format,
        ...(purpose ? { purpose } : {}),
      });
      if (isStale(epoch, epochRef.current)) return null;
      if (result.ok === false || !('text' in result)) {
        setError(result.ok === false ? result.code : 'network');
        return null;
      }
      if (result.breakCharacter) {
        const breakText = result.breakText ?? '';
        const lineIndex = messagesRef.current.length;
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: result.text },
          ...(breakText ? [{ role: 'partner' as const, text: breakText, audio: null }] : []),
        ]);
        markSafetyBreak(result.crisisKind, lineIndex);
        return null;
      }
      return result.text;
    } catch {
      setError('network');
      return null;
    } finally {
      setTranscribing(false);
    }
  }, [transcribing, markSafetyBreak]);

  /**
   * Incoming-call mode only: fetch the character's opening line — the call
   * they placed, already mid-crisis, before the user has said a word. The
   * server handles the empty-turns case when scenario.mode is incoming_call.
   */
  const open = useCallback(async (): Promise<{ ok: boolean; audio: string | null }> => {
    if (sending || messages.length > 0) return { ok: false, audio: null };
    setError(null);
    setSending(true);
    const epoch = epochRef.current;
    try {
      const result = await invokeRehearsal({
        mode: 'reply',
        scenario: scenarioRef.current,
        messages: [],
        ...(practiceEventIdRef.current ? { practiceEventId: practiceEventIdRef.current } : {}),
      });
      if (isStale(epoch, epochRef.current) || safetyBreakRef.current) return { ok: false, audio: null };
      if (result.ok === false) {
        setError(result.code);
        return { ok: false, audio: null };
      }
      if ('text' in result) {
        const audio = result.audio ?? null;
        setMessages([{ role: 'partner', text: result.text, audio }]);
        if (result.breakCharacter) markSafetyBreak(result.crisisKind);
        return { ok: true, audio };
      }
      return { ok: false, audio: null };
    } catch {
      setError('network');
      return { ok: false, audio: null };
    } finally {
      setSending(false);
    }
  }, [messages.length, sending]);

  const requestDebrief = useCallback(async () => {
    // A conversation that hit a crisis break is never sent for coaching.
    if (safetyBreakRef.current || debriefLoading || messages.filter((m) => m.role === 'user').length === 0) return;
    setError(null);
    setHint(null);
    setDebriefLoading(true);
    const epoch = epochRef.current;
    try {
      const history = messages.map(wireTurn);
      const result = await invokeRehearsal({ mode: 'debrief', scenario: scenarioRef.current, messages: history });
      if (isStale(epoch, epochRef.current)) return;
      if (result.ok === false || !('debrief' in result)) {
        if (result.ok === false && result.code === 'safety_break') {
          // The server found a crisis disclosure in the transcript: show the crisis card.
          markSafetyBreak();
          return;
        }
        setError(result.ok === false ? result.code : 'network');
        return;
      }
      // A break that landed while the coach was working wins: discard the coaching.
      if (safetyBreakRef.current) return;
      setDebrief(result.debrief);
    } catch {
      setError('network');
    } finally {
      setDebriefLoading(false);
    }
  }, [messages, debriefLoading, markSafetyBreak]);

  /** A fresh session. Screens only offer this from the debrief, which a crisis break never reaches. */
  const reset = useCallback(() => {
    epochRef.current += 1;
    safetyBreakRef.current = false;
    breakLineRef.current = null;
    setBreakLine(null);
    setHadSafetyBreak(false);
    setSafetyKind('unknown');
    setMessages([]);
    setError(null);
    setSafetyBreak(false);
    setDebrief(null);
    setHint(null);
  }, []);

  /**
   * "Redo from here": rewind to an earlier point in this conversation. The
   * partner's state is exactly the messages kept, so the next line the member
   * says lands where the weak moment used to be. A safety break is never
   * rewound: once the member disclosed a crisis, the session stays paused.
   */
  const restore = useCallback((turns: PartnerTurn[]) => {
    epochRef.current += 1;
    setMessages(turns);
    setError(null);
    setDebrief(null);
    setHint(null);
  }, []);

  /**
   * "I'm safe — keep practicing": only when the pause came from her latest
   * line. That line and the pause message leave the conversation (and every
   * later request), input reopens, and nothing in flight from before lands.
   * Returns the number of messages kept, or null when not offered.
   */
  const keepPracticing = useCallback((): number | null => {
    if (!safetyBreakRef.current) return null;
    const kept = keepPracticingFrom(messages, breakLineRef.current);
    if (!kept) return null;
    epochRef.current += 1;
    safetyBreakRef.current = false;
    breakLineRef.current = null;
    setBreakLine(null);
    setMessages(kept);
    setSafetyBreak(false);
    setSafetyKind('unknown');
    setError(null);
    setHint(null);
    return kept.length;
  }, [messages]);

  return {
    messages,
    sending,
    transcribing,
    error,
    safetyBreak,
    safetyKind,
    canKeepPracticing: safetyBreak && breakLine !== null,
    hadSafetyBreak,
    keepPracticing,
    debrief,
    debriefLoading,
    turnsLeft,
    hint,
    send,
    transcribeClip,
    open,
    requestDebrief,
    reset,
    restore,
  };
}
