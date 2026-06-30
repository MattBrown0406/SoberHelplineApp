import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { isAdminEmail } from '../src/lib/admin';
import { supabase } from '../src/lib/supabase';

type FunnelStats = {
  members: number;
  onboarded_loved_one: number;
  free_rsvps: number;
  attended: number;
  coaching_requested: number;
  coaching_confirmed: number;
  intervention_viewed: number;
  intervention_started: number;
  bands: { calm: number; watch: number; elevated: number; crisis: number };
};
type RsvpRow = { first_name: string; last_name: string; email: string; rsvped_at: string };
type QuestionRow = { id: string; first_name: string; last_name: string; question: string; submitted_at: string };
type ThreadRow = { thread_id: string; first_name: string; last_name: string; last_message: string | null; last_message_at: string | null; message_count: number };

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAccount();
  const { colors } = useTheme();
  const isAdmin = isAdminEmail(user?.email);

  const [zoomUrl, setZoomUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [loadingRsvps, setLoadingRsvps] = useState(true);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [archivingThread, setArchivingThread] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);

  // Guard: non-admin users should never reach this screen, but redirect just in case
  useEffect(() => {
    if (user && !isAdmin) {
      router.replace('/');
    }
  }, [user, isAdmin, router]);

  const loadData = useCallback(async () => {
    // Funnel + family-health snapshot
    const { data: funnelData } = await supabase.rpc('admin_funnel_stats');
    if (funnelData) setFunnel(funnelData as FunnelStats);

    // Load current Zoom URL
    const { data: session } = await supabase
      .from('sessions')
      .select('zoom_url')
      .eq('title', 'Monday Night Family Support')
      .single();
    if (session?.zoom_url) setZoomUrl(session.zoom_url);

    // Load RSVPs
    setLoadingRsvps(true);
    const { data: rsvpData, error: rsvpError } = await supabase.rpc('admin_get_family_squares_rsvps');
    if (!rsvpError && rsvpData) setRsvps(rsvpData as RsvpRow[]);
    setLoadingRsvps(false);

    // Load questions
    setLoadingQuestions(true);
    const { data: qData, error: qError } = await supabase.rpc('admin_get_session_questions');
    if (!qError && qData) setQuestions(qData as QuestionRow[]);
    setLoadingQuestions(false);

    // Load active member conversations
    setLoadingThreads(true);
    const { data: tData, error: tError } = await supabase.rpc('admin_get_active_threads');
    if (!tError && tData) setThreads(tData as ThreadRow[]);
    setLoadingThreads(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const saveZoomUrl = useCallback(async () => {
    if (!editingUrl.trim()) return;
    setSaving(true);
    const { error } = await supabase.rpc('admin_update_family_squares_zoom_url', {
      p_url: editingUrl.trim(),
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setZoomUrl(editingUrl.trim());
      setIsEditing(false);
    }
  }, [editingUrl]);

  if (!user || !isAdmin) return null;

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
      </TouchableOpacity>

      <Text style={[styles.heading, { color: colors.ink }]}>Admin</Text>

      {/* ── Funnel & family health ── */}
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Funnel & family health</Text>
        {!funnel ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
        ) : (
          <>
            <View style={styles.funnelRow}>
              <FunnelStat label="Members" value={funnel.members} colors={colors} />
              <FunnelStat label="Loved one set" value={funnel.onboarded_loved_one} colors={colors} />
            </View>
            <Text style={[styles.funnelStage, { color: colors.inkSoft }]}>
              Funnel: {funnel.free_rsvps} RSVP&apos;d → {funnel.attended} attended → {funnel.coaching_requested} requested coaching → {funnel.coaching_confirmed} confirmed → {funnel.intervention_started} planning intervention
            </Text>
            <Text style={[styles.funnelStage, { color: colors.inkSoft }]}>
              ({funnel.intervention_viewed} viewed the intervention page)
            </Text>

            <Text style={[styles.funnelSubhead, { color: colors.ink }]}>Readiness bands</Text>
            <View style={styles.bandsRow}>
              <BandPill label="Calm" value={funnel.bands.calm} color={colors.green} colors={colors} />
              <BandPill label="Watch" value={funnel.bands.watch} color="#e6c070" colors={colors} />
              <BandPill label="Elevated" value={funnel.bands.elevated} color={colors.coral} colors={colors} />
              <BandPill label="Crisis" value={funnel.bands.crisis} color={colors.coral} colors={colors} />
            </View>
            <Text style={[styles.funnelNote, { color: colors.inkSoft }]}>
              Attended = tapped Join on a group call. Intervention = opened/started planning. RSVP from session RSVPs, coaching from bookings.
            </Text>
          </>
        )}
      </View>

      {/* ── Zoom Link ── */}
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Family Squares — Weekly Zoom Link</Text>

        {isEditing ? (
          <>
            <TextInput
              style={[styles.input, { color: colors.ink, borderColor: colors.line }]}
              value={editingUrl}
              onChangeText={setEditingUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://zoom.us/j/..."
              placeholderTextColor={colors.inkSoft}
            />
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={saveZoomUrl}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline, { borderColor: colors.line }]}
                onPress={() => setIsEditing(false)}
              >
                <Text style={[styles.btnText, { color: colors.ink }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.urlText, { color: colors.inkSoft }]} numberOfLines={2}>
              {zoomUrl || 'No link set'}
            </Text>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, marginTop: 12 }]}
              onPress={() => { setEditingUrl(zoomUrl); setIsEditing(true); }}
            >
              <Text style={styles.btnText}>Update Link</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── RSVP List ── */}
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>
          RSVPs — This Week ({rsvps.length})
        </Text>

        {loadingRsvps ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : rsvps.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.inkSoft }]}>No RSVPs yet.</Text>
        ) : (
          <FlatList
            data={rsvps}
            keyExtractor={(item) => item.email}
            scrollEnabled={false}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.line }]} />
            )}
            renderItem={({ item }) => (
              <View style={styles.rsvpRow}>
                <Text style={[styles.rsvpName, { color: colors.ink }]}>
                  {item.first_name} {item.last_name}
                </Text>
                <Text style={[styles.rsvpEmail, { color: colors.inkSoft }]}>{item.email}</Text>
              </View>
            )}
          />
        )}

        <TouchableOpacity onPress={loadData} style={{ marginTop: 16 }}>
          <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* ── Member Questions ── */}
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>
          Member Questions ({questions.length})
        </Text>

        {loadingQuestions ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : questions.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.inkSoft }]}>No questions submitted yet.</Text>
        ) : (
          <FlatList
            data={questions}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.line }]} />
            )}
            renderItem={({ item }) => (
              <View style={styles.questionRow}>
                <Text style={[styles.questionText, { color: colors.ink }]}>"{item.question}"</Text>
                <Text style={[styles.rsvpName, { color: colors.inkSoft, marginTop: 4 }]}>
                  — {item.first_name} {item.last_name} · {new Date(item.submitted_at).toLocaleDateString()}
                </Text>
              </View>
            )}
          />
        )}
      </View>

      {/* ── Member Conversations ── */}
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>
          Active Conversations ({threads.length})
        </Text>

        {loadingThreads ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : threads.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.inkSoft }]}>No active conversations.</Text>
        ) : (
          <FlatList
            data={threads}
            keyExtractor={(item) => item.thread_id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.line }]} />
            )}
            renderItem={({ item }) => (
              <View style={styles.threadRow}>
                <View style={styles.threadInfo}>
                  <Text style={[styles.rsvpName, { color: colors.ink }]}>
                    {item.first_name} {item.last_name}
                  </Text>
                  {item.last_message ? (
                    <Text style={[styles.threadPreview, { color: colors.inkSoft }]} numberOfLines={1}>
                      {item.last_message}
                    </Text>
                  ) : null}
                  <Text style={[styles.threadMeta, { color: colors.inkSoft }]}>
                    {item.message_count} message{item.message_count !== 1 ? 's' : ''}
                    {item.last_message_at ? ` · ${new Date(item.last_message_at).toLocaleDateString()}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.archiveThreadBtn, { borderColor: colors.line }]}
                  disabled={archivingThread === item.thread_id}
                  onPress={() => {
                    Alert.alert(
                      'Archive conversation?',
                      `This will archive ${item.first_name}'s current thread and start a fresh one for them.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Archive',
                          style: 'destructive',
                          onPress: async () => {
                            setArchivingThread(item.thread_id);
                            await supabase.rpc('archive_thread', { p_thread_id: item.thread_id });
                            setArchivingThread(null);
                            void loadData();
                          },
                        },
                      ],
                    );
                  }}
                >
                  {archivingThread === item.thread_id
                    ? <ActivityIndicator size="small" color={colors.inkSoft} />
                    : <Text style={[styles.archiveThreadBtnText, { color: colors.inkSoft }]}>Archive</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        <TouchableOpacity onPress={loadData} style={{ marginTop: 16 }}>
          <Text style={[styles.refreshText, { color: colors.primary }]}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

type Colors = ReturnType<typeof useTheme>['colors'];

function FunnelStat({ label, value, colors }: { label: string; value: number; colors: Colors }) {
  return (
    <View style={styles.funnelStat}>
      <Text style={[styles.funnelStatValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.funnelStatLabel, { color: colors.inkSoft }]}>{label}</Text>
    </View>
  );
}

function BandPill({ label, value, color, colors }: { label: string; value: number; color: string; colors: Colors }) {
  return (
    <View style={[styles.bandPill, { borderColor: colors.line }]}>
      <View style={[styles.bandDot, { backgroundColor: color }]} />
      <Text style={[styles.bandPillText, { color: colors.ink }]}>{label} {value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 48 },
  funnelRow: { flexDirection: 'row', gap: 24, marginBottom: 12 },
  funnelStat: { alignItems: 'flex-start' },
  funnelStatValue: { fontSize: 26, fontWeight: '800' },
  funnelStatLabel: { fontSize: 12, marginTop: 2 },
  funnelStage: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  funnelSubhead: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  bandsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  bandPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  bandDot: { width: 9, height: 9, borderRadius: 5 },
  bandPillText: { fontSize: 12.5, fontWeight: '600' },
  funnelNote: { fontSize: 11.5, lineHeight: 17, fontStyle: 'italic' },
  backBtn: { marginBottom: 8 },
  backText: { fontSize: 15 },
  heading: { fontSize: 26, fontWeight: '700', marginBottom: 24 },
  card: { borderRadius: 12, borderWidth: 1, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  urlText: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, marginBottom: 12,
  },
  row: { flexDirection: 'row', gap: 10 },
  btn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, alignItems: 'center' },
  btnOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyText: { fontSize: 14, marginTop: 4 },
  rsvpRow: { paddingVertical: 10 },
  rsvpName: { fontSize: 15, fontWeight: '600' },
  rsvpEmail: { fontSize: 13, marginTop: 2 },
  separator: { height: 1 },
  refreshText: { fontSize: 14, fontWeight: '600' },
  questionRow: { paddingVertical: 10 },
  questionText: { fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  threadRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  threadInfo: { flex: 1 },
  threadPreview: { fontSize: 13, marginTop: 2 },
  threadMeta: { fontSize: 11, marginTop: 3 },
  archiveThreadBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  archiveThreadBtnText: { fontSize: 12, fontWeight: '600' },
});
