import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  AudioSession,
  VideoTrack,
  LiveKitRoom,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  useChat,
  registerGlobals,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { supabase } from '../src/lib/supabase';
import { LIVEKIT_URL, SUPABASE_URL } from '../src/config';

registerGlobals();

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenResult {
  token: string;
  isHost: boolean;
  identity: string;
}

// ── Token fetch ───────────────────────────────────────────────────────────────

async function fetchLiveKitToken(room: string): Promise<TokenResult> {
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
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  return res.json();
}

async function removeParticipant(room: string, identity: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  await fetch(`${SUPABASE_URL}/functions/v1/livekit-remove`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ room, identity }),
  });
}

// ── Host view ─────────────────────────────────────────────────────────────────

function HostView({
  roomName,
  onEnd,
}: {
  roomName: string;
  onEnd: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('live');
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera]);
  const { chatMessages, send } = useChat();

  const myTrack = tracks.find((tr) => tr.participant.isLocal);

  async function handleRemove(identity: string) {
    Alert.alert(
      t('host.remove'),
      identity,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('host.remove'),
          style: 'destructive',
          onPress: () => removeParticipant(roomName, identity),
        },
      ],
    );
  }

  return (
    <View style={[styles.roomContainer, { backgroundColor: colors.ink }]}>
      {/* Self-camera preview */}
      <View style={styles.hostPreviewWrap}>
        {myTrack ? (
          <VideoTrack
            trackRef={myTrack}
            style={styles.hostPreview}
            mirror
            objectFit="cover"
          />
        ) : (
          <View style={[styles.hostPreviewPlaceholder, { backgroundColor: colors.primaryDark }]}>
            <Text style={styles.placeholderIcon}>📷</Text>
          </View>
        )}

        {/* Participant count badge */}
        <View style={[styles.countBadge, { backgroundColor: colors.coral }]}>
          <Text style={styles.countBadgeText}>
            {t('host.watching', { count: remoteParticipants.length })}
          </Text>
        </View>

        {/* LIVE badge */}
        <View style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>{t('live')}</Text>
        </View>
      </View>

      {/* Questions list */}
      <View style={styles.chatSection}>
        <Text style={[styles.chatEyebrow, { color: colors.inkSoft }]}>
          {t('chat.eyebrow')}
        </Text>
        <FlatList
          data={[...chatMessages].reverse()}
          keyExtractor={(m) => m.id}
          style={styles.messageList}
          inverted
          renderItem={({ item }) => (
            <View style={[styles.messageRow, { borderBottomColor: colors.primaryDark }]}>
              <View style={styles.messageBody}>
                <Text style={[styles.messageSender, { color: colors.inkSoft }]}>
                  {item.from?.name ?? item.from?.identity ?? '?'}
                </Text>
                <Text style={[styles.messageText, { color: '#fff' }]}>{item.message}</Text>
              </View>
              <TouchableOpacity
                style={[styles.removeBtn, { borderColor: colors.coral }]}
                onPress={() => handleRemove(item.from?.identity ?? '')}
              >
                <Text style={[styles.removeBtnText, { color: colors.coral }]}>
                  {t('host.remove')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>

      {/* End broadcast */}
      <TouchableOpacity
        style={[styles.endBtn, { backgroundColor: colors.coral }]}
        onPress={onEnd}
        activeOpacity={0.85}
      >
        <Text style={styles.endBtnText}>{t('endBroadcast')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Viewer view ───────────────────────────────────────────────────────────────

function ViewerView({ onLeave }: { onLeave: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('live');
  const tracks = useTracks([Track.Source.Camera]);
  const { chatMessages, send } = useChat();
  const [draft, setDraft] = useState('');

  const hostTrack = tracks.find((tr) => !tr.participant.isLocal);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await send(text);
  }

  return (
    <View style={[styles.roomContainer, { backgroundColor: '#000' }]}>
      {/* Host video full-bleed */}
      {hostTrack ? (
        <VideoTrack
          trackRef={hostTrack}
          style={styles.hostVideo}
          objectFit="cover"
        />
      ) : (
        <View style={[styles.hostVideo, styles.noHostPlaceholder]}>
          <Text style={styles.noHostText}>{t('viewer.noHost')}</Text>
        </View>
      )}

      {/* LIVE badge overlay */}
      <View style={styles.liveBadgeOverlay}>
        <View style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>{t('live')}</Text>
        </View>
      </View>

      {/* Leave button overlay */}
      <TouchableOpacity
        style={[styles.leaveBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
        onPress={onLeave}
        activeOpacity={0.85}
      >
        <Text style={[styles.leaveBtnText, { color: '#fff' }]}>{t('leave')}</Text>
      </TouchableOpacity>

      {/* Questions + 911/988 pinned at bottom */}
      <View style={[styles.viewerBottom, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
        {/* Scrollable questions */}
        <FlatList
          data={[...chatMessages].reverse()}
          keyExtractor={(m) => m.id}
          style={styles.viewerMessageList}
          inverted
          renderItem={({ item }) => (
            <View style={styles.viewerMessageRow}>
              <Text style={styles.viewerSender}>
                {item.from?.name ?? '?'}
              </Text>
              <Text style={styles.viewerMessageText}>{item.message}</Text>
            </View>
          )}
        />

        {/* Chat input */}
        <View style={styles.chatInputRow}>
          <TextInput
            style={[styles.chatInput, { color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }]}
            placeholder={t('chat.placeholder')}
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={draft}
            onChangeText={setDraft}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : 'rgba(255,255,255,0.2)' }]}
            disabled={!draft.trim()}
            onPress={handleSend}
            activeOpacity={0.85}
          >
            <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
          </TouchableOpacity>
        </View>

        {/* 911/988 safety line — always visible */}
        <View style={styles.crisisRow}>
          <TouchableOpacity onPress={() => Linking.openURL('tel:911')} style={styles.crisisBtn}>
            <Text style={[styles.crisisBtnText, { color: colors.coral }]}>
              {t('crisis.line911')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL('tel:988')} style={styles.crisisBtn}>
            <Text style={[styles.crisisBtnText, { color: colors.primary }]}>
              {t('crisis.line988')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LiveRoomScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('live');
  const router = useRouter();
  const { user } = useAccount();
  const params = useLocalSearchParams<{ room: string }>();
  const roomName = params.room ?? '';

  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        await AudioSession.startAudioSession();
        const result = await fetchLiveKitToken(roomName);
        setTokenResult(result);

        if (result.isHost) {
          await supabase.rpc('set_host_live', {
            p_room_name: roomName,
            p_is_live: true,
          });
        }
      } catch (e) {
        setError(String(e));
      }
    }
    init();

    return () => {
      AudioSession.stopAudioSession();
    };
  }, [roomName]);

  async function handleLeaveOrEnd() {
    if (tokenResult?.isHost) {
      await supabase.rpc('set_host_live', {
        p_room_name: roomName,
        p_is_live: false,
      });
    }
    router.back();
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.ink }]}>
        <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.endBtn, { backgroundColor: colors.primary, marginTop: 20 }]}>
          <Text style={styles.endBtnText}>{t('leave')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!tokenResult) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.ink }]}>
        <Text style={[styles.connectingText, { color: colors.inkSoft }]}>
          {t('connecting')}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <LiveKitRoom
      token={tokenResult.token}
      serverUrl={LIVEKIT_URL}
      connect
      audio={tokenResult.isHost}
      video={tokenResult.isHost}
      onConnected={() => setConnected(true)}
      onDisconnected={handleLeaveOrEnd}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {tokenResult.isHost ? (
          <HostView roomName={roomName} onEnd={handleLeaveOrEnd} />
        ) : (
          <ViewerView onLeave={handleLeaveOrEnd} />
        )}
      </SafeAreaView>
    </LiveKitRoom>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  connectingText: { fontSize: 16 },
  errorText: { fontSize: 15, textAlign: 'center' },

  roomContainer: { flex: 1 },

  // Host
  hostPreviewWrap: {
    height: 280,
    position: 'relative',
    backgroundColor: '#111',
  },
  hostPreview: { width: '100%', height: '100%' },
  hostPreviewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: { fontSize: 48 },
  countBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  countBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  chatSection: { flex: 1, padding: 16 },
  chatEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  messageList: { flex: 1 },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  messageBody: { flex: 1 },
  messageSender: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  messageText: { fontSize: 14, lineHeight: 20 },
  removeBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  removeBtnText: { fontSize: 12, fontWeight: '600' },

  endBtn: { margin: 16, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  endBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Shared
  liveBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#e53e3e',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  liveBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Viewer
  hostVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  noHostPlaceholder: {
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noHostText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, textAlign: 'center' },

  liveBadgeOverlay: { position: 'absolute', top: 48, left: 0, right: 0 },

  leaveBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  leaveBtnText: { fontSize: 13, fontWeight: '700' },

  viewerBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: 280,
    paddingTop: 8,
  },
  viewerMessageList: { maxHeight: 140, paddingHorizontal: 12 },
  viewerMessageRow: { paddingVertical: 4 },
  viewerSender: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  viewerMessageText: { color: '#fff', fontSize: 13 },

  chatInputRow: { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 6 },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  crisisRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  crisisBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  crisisBtnText: { fontSize: 12, fontWeight: '700' },
});
