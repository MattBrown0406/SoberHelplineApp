import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { finalizeRecording } from '../../lib/appFlowGuards';
import { MAX_METERING_SAMPLES, type VoiceClip } from '../../lib/practiceDelivery';
import { MAX_AUDIO_B64, MAX_CLIP_MS } from '../../lib/practiceScenarios';

/**
 * Speech capture for conversation practice: mono 64 kbps AAC is plenty for
 * speech-to-text and keeps a read-aloud letter (~2–3 minutes) under the
 * server's upload cap. Metering feeds the delivery feedback's loudness check.
 */
const SPEECH_RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  android: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android, numberOfChannels: 1, bitRate: 64000 },
  ios: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios, numberOfChannels: 1, bitRate: 64000 },
  web: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.web, bitsPerSecond: 64000 },
};
const METERING_INTERVAL_MS = 150;
/** Slack for the auto-stop to land (status updates arrive every 150 ms). */
const CLIP_OVERRUN_MS = 3_000;
/** "About 30 seconds left" shows up this long before a recording's limit. */
const NEAR_LIMIT_MS = 30_000;
/** A slipped finger makes a fraction-of-a-second clip that Whisper turns into "Thank you". */
const MIN_CLIP_MS = 700;

type Options = {
  /** Speech-to-text; null/'' means nothing usable was heard. */
  transcribe: (audioB64: string, format: string) => Promise<string | null>;
  onPermissionDenied: () => void;
  onRecordingError: () => void;
  /** A recording that hit the length cap is stopped and delivered here. */
  onAutoStop: (clip: VoiceClip) => void;
  /** The recording couldn't be read for upload (e.g. a browser without file access). */
  onUnavailable: () => void;
  /** The recording is too large to upload — say so rather than failing silently. */
  onTooLong: () => void;
};

const UPLOAD_FORMATS = ['m4a', 'mp4', 'mp3', 'wav', 'webm'];

/**
 * The recorded file as base64 + its format. expo-file-system can't read files
 * on web, where the recording is a blob: URL — read it through fetch/FileReader.
 */
async function readRecording(uri: string): Promise<{ b64: string; format: string }> {
  if (Platform.OS !== 'web') {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
    return { b64, format: UPLOAD_FORMATS.includes(ext) ? ext : 'm4a' };
  }
  const blob = await (await fetch(uri)).blob();
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.onloadend = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
  const type = blob.type.toLowerCase();
  const format = type.includes('mp4') || type.includes('m4a') ? 'mp4' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'webm';
  return { b64, format };
}

export function useSpeechCapture({
  transcribe,
  onPermissionDenied,
  onRecordingError,
  onAutoStop,
  onUnavailable,
  onTooLong,
}: Options) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  // Recording runs long enough that the member should hear the end coming.
  const [nearLimit, setNearLimit] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pressActiveRef = useRef(false);
  // Privacy: once the screen is gone, no recorder may start, keep running,
  // upload, or deliver — even if a permission prompt was still open.
  const mountedRef = useRef(true);
  const limitRef = useRef(MAX_CLIP_MS);
  const nearLimitRef = useRef(false);
  const meteringRef = useRef<number[]>([]);
  const autoStoppingRef = useRef(false);
  // cancel() moves to a new generation: a stop() already in flight (reading,
  // uploading, transcribing) then delivers nothing.
  const generationRef = useRef(0);
  const callbacks = useRef({ transcribe, onPermissionDenied, onRecordingError, onAutoStop, onUnavailable, onTooLong });
  callbacks.current = { transcribe, onPermissionDenied, onRecordingError, onAutoStop, onUnavailable, onTooLong };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pressActiveRef.current = false;
      const active = recordingRef.current;
      recordingRef.current = null;
      if (active) void active.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    const generation = generationRef.current;
    const discarded = () => !mountedRef.current || generation !== generationRef.current;
    pressActiveRef.current = false;
    nearLimitRef.current = false;
    if (mountedRef.current) setNearLimit(false);
    const active = recordingRef.current;
    if (!active) return null;
    recordingRef.current = null;
    let result;
    let durationMillis = 0;
    try {
      const status = await active.getStatusAsync();
      durationMillis = status.durationMillis ?? 0;
      result = await finalizeRecording(
        () => active.stopAndUnloadAsync(),
        () => active.getURI(),
        () => Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }),
      );
    } catch {
      if (!mountedRef.current) return null;
      // Clear the dead recorder so the next press can start a fresh one.
      setRecording(null);
      callbacks.current.onRecordingError();
      return null;
    }
    // Gone (or cancelled) mid-stop: nothing is read, uploaded, or delivered.
    if (discarded()) return null;
    setRecording(null);
    if (result.restoreError) {
      // The capture is already unloaded; keep the UI usable and surface the
      // audio-session problem without pretending recording is still active.
      callbacks.current.onRecordingError();
    }
    if (!result.uri || durationMillis < MIN_CLIP_MS) return null;
    // Recordings stop at their limit; anything longer never goes up (it's billed per minute).
    if (durationMillis > limitRef.current + CLIP_OVERRUN_MS) {
      callbacks.current.onTooLong();
      return null;
    }
    const metering = meteringRef.current.slice(-MAX_METERING_SAMPLES);
    let recorded: { b64: string; format: string };
    try {
      recorded = await readRecording(result.uri);
    } catch {
      if (!discarded()) callbacks.current.onUnavailable();
      return null;
    }
    if (discarded()) return null;
    if (!recorded.b64) {
      callbacks.current.onUnavailable();
      return null;
    }
    if (recorded.b64.length > MAX_AUDIO_B64) {
      callbacks.current.onTooLong();
      return null;
    }
    try {
      const text = (await callbacks.current.transcribe(recorded.b64, recorded.format))?.trim();
      if (!text || discarded()) return null;
      return { transcript: text, durationMs: durationMillis, ...(metering.length ? { metering } : {}) };
    } catch {
      // transcription failed — the partner hook's error state shows the message
      return null;
    }
  }, []);

  /** Start recording; it stops itself at `maxMs` (a read-aloud letter gets longer than one line). */
  const start = useCallback(async (maxMs: number = MAX_CLIP_MS): Promise<void> => {
    if (!mountedRef.current) return;
    pressActiveRef.current = true;
    autoStoppingRef.current = false;
    nearLimitRef.current = false;
    setNearLimit(false);
    limitRef.current = maxMs;
    meteringRef.current = [];
    // After every await: if the screen is gone or the press ended, release the mic.
    const abandoned = () => !mountedRef.current || !pressActiveRef.current;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (!mountedRef.current) return;
      if (status !== 'granted') {
        callbacks.current.onPermissionDenied();
        return;
      }
      if (abandoned()) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      if (abandoned()) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
        return;
      }
      const { recording: rec } = await Audio.Recording.createAsync(
        SPEECH_RECORDING_OPTIONS,
        (s) => {
          if (!s.isRecording || !mountedRef.current) return;
          if (typeof s.metering === 'number' && meteringRef.current.length < MAX_METERING_SAMPLES * 2) {
            meteringRef.current.push(s.metering);
          }
          const elapsed = s.durationMillis ?? 0;
          if (elapsed >= limitRef.current - NEAR_LIMIT_MS && !nearLimitRef.current) {
            nearLimitRef.current = true;
            setNearLimit(true);
          }
          if (elapsed >= limitRef.current && !autoStoppingRef.current) {
            autoStoppingRef.current = true;
            void stop().then((clip) => {
              if (clip && mountedRef.current) callbacks.current.onAutoStop(clip);
            });
          }
        },
        METERING_INTERVAL_MS,
      );
      // The finger may have lifted (or the screen closed) while we awaited the
      // permission prompt or recorder startup — the iOS permission alert
      // cancels the touch, and on web the browser prompt can sit open while she
      // navigates away. Never leave the mic running with nobody holding it.
      if (abandoned()) {
        await rec.stopAndUnloadAsync().catch(() => undefined);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
        return;
      }
      recordingRef.current = rec;
      setRecording(rec);
    } catch {
      // no mic (simulator) — typing still works
    }
  }, [stop]);

  /**
   * Stop and throw away whatever is being recorded — no upload, no
   * transcript, no delivery. For when the practice moves on (coaching, the end
   * of a call) while the mic is live or a clip is still being processed.
   */
  const cancel = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    pressActiveRef.current = false;
    autoStoppingRef.current = true;
    nearLimitRef.current = false;
    const active = recordingRef.current;
    recordingRef.current = null;
    if (mountedRef.current) {
      setRecording(null);
      setNearLimit(false);
    }
    if (active) {
      await active.stopAndUnloadAsync().catch(() => undefined);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
    }
  }, []);

  return { recording: recording !== null, nearLimit, start, stop, cancel };
}
