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
import { supabase } from '../src/lib/supabase';

const ADMIN_EMAIL = 'matt@soberhelpline.com';

type RsvpRow = { first_name: string; last_name: string; email: string; rsvped_at: string };
type QuestionRow = { id: string; first_name: string; last_name: string; question: string; submitted_at: string };

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAccount();
  const { colors } = useTheme();

  const [zoomUrl, setZoomUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rsvps, setRsvps] = useState<RsvpRow[]>([]);
  const [loadingRsvps, setLoadingRsvps] = useState(true);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);

  // Guard: non-admin users should never reach this screen, but redirect just in case
  useEffect(() => {
    if (user && user.email !== ADMIN_EMAIL) {
      router.replace('/');
    }
  }, [user, router]);

  const loadData = useCallback(async () => {
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

  if (!user || user.email !== ADMIN_EMAIL) return null;

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
      </TouchableOpacity>

      <Text style={[styles.heading, { color: colors.ink }]}>Admin</Text>

      {/* ── Zoom Link ── */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Family Squares — Weekly Zoom Link</Text>

        {isEditing ? (
          <>
            <TextInput
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
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
                style={[styles.btn, styles.btnOutline, { borderColor: colors.border }]}
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
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
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
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 48 },
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
});
