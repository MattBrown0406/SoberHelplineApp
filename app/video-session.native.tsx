import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { useTheme } from '../src/contexts/ThemeContext';
import { supabase } from '../src/lib/supabase';
import { LIVEKIT_URL, SUPABASE_URL } from '../src/config';

registerGlobals();

type TokenResult = {
  token: string;
  identity: string;
  isHost: boolean;
  isPrivateVideo?: boolean;
  canPublish?: boolean;
};

async function fetchPrivateVideoToken(room: string): Promise<TokenResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ room }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error ?? `Token fetch failed: ${res.status}`);
  if (!payload?.isPrivateVideo) throw new Error('This room is not a private video session.');
  return payload as TokenResult;
}

function PrivateVideoCall({ onLeave }: { onLeave: () => void }) {
  const { colors } = useTheme();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera]);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const localTrack = tracks.find((tr) => tr.participant.isLocal);
  const remoteTrack = tracks.find((tr) => !tr.participant.isLocal);
  const remoteName = remoteParticipants[0]?.name ?? remoteParticipants[0]?.identity ?? 'Waiting for the other person';

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    setMicOn(next);
    await (localParticipant as any)?.setMicrophoneEnabled?.(next);
  }, [localParticipant, micOn]);

  const toggleCamera = useCallback(async () => {
    const next = !cameraOn;
    setCameraOn(next);
    await (localParticipant as any)?.setCameraEnabled?.(next);
  }, [cameraOn, localParticipant]);

  const remoteVideo = remoteTrack ? (
    <VideoTrack trackRef={remoteTrack} style={styles.remoteVideo} objectFit="cover" />
  ) : (
    <View style={[styles.remotePlaceholder, { backgroundColor: colors.ink }]}>
      <Text style={styles.waitingIcon}>🎥</Text>
      <Text style={styles.waitingTitle}>Private Video Support</Text>
      <Text style={styles.waitingBody}>{remoteName}</Text>
      <Text style={styles.waitingNote}>This is not an emergency service. Call 911 or 988 for immediate danger.</Text>
    </View>
  );

  return (
    <View style={styles.callRoot}>
      {remoteVideo}
      {localTrack && cameraOn ? (
        <VideoTrack trackRef={localTrack} style={styles.selfPreview} mirror objectFit="cover" />
      ) : (
        <View style={[styles.selfPreview, styles.selfPreviewOff]}>
          <Text style={styles.selfPreviewOffText}>Camera off</Text>
        </View>
      )}
      <View style={styles.topBadge}>
        <Text style={styles.topBadgeText}>{remoteParticipants.length > 0 ? 'Connected' : 'Waiting'}</Text>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity style={[styles.controlBtn, { backgroundColor: micOn ? '#ffffff' : colors.coral }]} onPress={toggleMic}>
          <Text style={[styles.controlText, { color: micOn ? colors.ink : '#fff' }]}>{micOn ? 'Mute' : 'Unmute'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, { backgroundColor: cameraOn ? '#ffffff' : colors.coral }]} onPress={toggleCamera}>
          <Text style={[styles.controlText, { color: cameraOn ? colors.ink : '#fff' }]}>{cameraOn ? 'Camera Off' : 'Camera On'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlBtn, styles.leaveBtn]} onPress={onLeave}>
          <Text style={[styles.controlText, { color: '#fff' }]}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function VideoSessionScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ room: string }>();
  const roomName = useMemo(() => String(params.room ?? ''), [params.room]);
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        if (!roomName) throw new Error('Missing video room.');
        await AudioSession.startAudioSession();
        const result = await fetchPrivateVideoToken(roomName);
        if (active) setTokenResult(result);
      } catch (e) {
        if (active) setError(String(e));
      }
    }
    void init();
    return () => {
      active = false;
      void AudioSession.stopAudioSession();
    };
  }, [roomName]);

  const leave = useCallback(() => router.back(), [router]);

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.ink }]}>
        <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
        <TouchableOpacity onPress={leave} style={[styles.errorBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.errorBtnText}>Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!tokenResult) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.ink }]}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.connectingText}>Connecting private video session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <LiveKitRoom
      token={tokenResult.token}
      serverUrl={LIVEKIT_URL}
      connect
      audio
      video
      onDisconnected={leave}
      onError={(e) => Alert.alert('Video session error', String(e))}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <PrivateVideoCall onLeave={leave} />
      </SafeAreaView>
    </LiveKitRoom>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  connectingText: { color: '#fff', fontSize: 15, marginTop: 12 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorBtn: { marginTop: 20, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 },
  errorBtnText: { color: '#fff', fontWeight: '800' },
  callRoot: { flex: 1, backgroundColor: '#000' },
  remoteVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  remotePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  waitingIcon: { fontSize: 54, marginBottom: 16 },
  waitingTitle: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' },
  waitingBody: { color: 'rgba(255,255,255,0.72)', fontSize: 16, marginTop: 10, textAlign: 'center' },
  waitingNote: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, marginTop: 22, textAlign: 'center' },
  selfPreview: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 112,
    height: 160,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: '#111',
  },
  selfPreviewOff: { alignItems: 'center', justifyContent: 'center' },
  selfPreviewOffText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  topBadge: {
    position: 'absolute',
    top: 64,
    left: 16,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  controls: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  controlBtn: { borderRadius: 99, paddingHorizontal: 16, paddingVertical: 12, minWidth: 86, alignItems: 'center' },
  controlText: { fontSize: 13, fontWeight: '800' },
  leaveBtn: { backgroundColor: '#d83a34' },
});
