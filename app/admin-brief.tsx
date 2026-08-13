import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { isAdminEmail } from '../src/lib/admin';
import { supabase } from '../src/lib/supabase';
import {
  briefCaregiverAverage,
  briefMoodAverage,
  signLabel,
  type AdminBriefDetail,
} from '../src/lib/situationBrief';

type TrackerSignDef = { id: string; label: string; category: string };

const BAND_COLOR: Record<string, string> = {
  calm: '#4d8a63',
  watch: '#e6c070',
  elevated: '#c4604f',
  crisis: '#c4604f',
};

/**
 * Admin view of one situation brief. Opening it marks it read; replying goes
 * through the member's existing thread so the conversation lives where the
 * member already looks for Matt.
 */
export default function AdminBriefScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAccount();
  const { t: tTracker } = useTranslation('tracker');
  const params = useLocalSearchParams<{ briefId: string }>();
  const briefId = typeof params.briefId === 'string' ? params.briefId : null;

  const [brief, setBrief] = useState<AdminBriefDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingThread, setOpeningThread] = useState(false);

  const isAdmin = isAdminEmail(user?.email);

  const warningSignDefs = useMemo(
    () => tTracker('warning.signs', { returnObjects: true }) as TrackerSignDef[],
    [tTracker],
  );
  const recoverySignDefs = useMemo(
    () => tTracker('recovery.signs', { returnObjects: true }) as TrackerSignDef[],
    [tTracker],
  );

  useEffect(() => {
    if (user && !isAdmin) router.replace('/');
  }, [user, isAdmin, router]);

  const load = useCallback(async () => {
    if (!briefId || !isAdmin) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_situation_brief', { p_id: briefId });
    if (!error && data) {
      setBrief(data as AdminBriefDetail);
      // Reading it is the "read" event; forward-only server-side.
      void supabase.rpc('admin_mark_brief', { p_id: briefId, p_status: 'read' });
    }
    setLoading(false);
  }, [briefId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const openThread = useCallback(async () => {
    if (!brief || openingThread) return;
    setOpeningThread(true);
    const { data: threadId, error } = await supabase.rpc('admin_get_or_create_thread', {
      p_account_id: brief.account_id,
    });
    if (!error && threadId) {
      // Opening the reply channel from a brief counts as replying to it.
      void supabase.rpc('admin_mark_brief', { p_id: brief.id, p_status: 'replied' });
      router.push({ pathname: '/admin-thread' as never, params: { threadId: String(threadId) } });
    }
    setOpeningThread(false);
  }, [brief, openingThread, router]);

  if (!user || !isAdmin) return null;

  if (loading || !brief) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </ScreenContainer>
    );
  }

  const sections = brief.sections;
  const mood = sections.mood ?? [];
  const moodAvg = briefMoodAverage(mood);
  const capacityAvg = briefCaregiverAverage(mood, 'capacity');
  const pressureAvg = briefCaregiverAverage(mood, 'pressure');
  const lowDays = mood.filter((m) => m.mood <= 2).length;
  const warnings = [...new Set((sections.tracker ?? []).filter((s) => s.kind === 'warning').map((s) => s.sign_key))];
  const recoveries = [...new Set((sections.tracker ?? []).filter((s) => s.kind === 'recovery').map((s) => s.sign_key))];
  const name = [brief.first_name, brief.last_name].filter(Boolean).join(' ') || 'Member';
  const bandColor = BAND_COLOR[brief.band] ?? colors.inkSoft;
  const rehearsals = sections.rehearsal ?? [];

  return (
    <ScreenContainer scroll backgroundColor={colors.cream} contentContainerStyle={styles.inner}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
        <Text style={[styles.backText, { color: colors.primary }]}>‹ Situation briefs</Text>
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.ink }]}>{name}</Text>
      <Text style={[styles.meta, { color: colors.inkSoft }]}>
        {brief.email ?? ''}{brief.email ? ' · ' : ''}{new Date(brief.created_at).toLocaleString()}
      </Text>

      <View style={styles.bandRow}>
        <View style={[styles.bandPill, { borderColor: bandColor }]}>
          <View style={[styles.bandDot, { backgroundColor: bandColor }]} />
          <Text style={[styles.bandPillText, { color: colors.ink }]}>
            {brief.band.toUpperCase()} · {brief.score}{brief.sustained ? ' · SUSTAINED' : ''}
          </Text>
        </View>
      </View>

      {brief.note ? (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>In their own words</Text>
          <Text style={[styles.noteText, { color: colors.ink }]}>“{brief.note}”</Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Check-ins (7d)</Text>
        {mood.length === 0 ? (
          <Text style={[styles.body, { color: colors.inkSoft }]}>No check-ins.</Text>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.inkSoft }]}>
              Avg {moodAvg ?? '—'}/5 · {lowDays} hard day{lowDays === 1 ? '' : 's'}
            </Text>
            {capacityAvg !== null && pressureAvg !== null && (
              <Text style={[styles.body, { color: colors.inkSoft, marginTop: 4 }]}>
                Avg capacity {capacityAvg}/5 · avg pressure {pressureAvg}/5
              </Text>
            )}
            {mood.map((m) => (
              <Text key={m.day} style={[styles.moodRow, { color: colors.ink }]}>
                {m.day} — {'●'.repeat(m.mood)}{'○'.repeat(5 - m.mood)} {m.mood}/5
                {typeof m.capacity === 'number' ? ` · capacity ${m.capacity}/5` : ''}
                {typeof m.pressure === 'number' ? ` · pressure ${m.pressure}/5` : ''}
                {m.support_need ? ` · needs ${m.support_need.replaceAll('_', ' ')}` : ''}
                {m.note ? `  “${m.note}”` : ''}
              </Text>
            ))}
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Tracker (14d)</Text>
        {warnings.length === 0 && recoveries.length === 0 ? (
          <Text style={[styles.body, { color: colors.inkSoft }]}>No signs logged.</Text>
        ) : (
          <>
            {warnings.map((key) => (
              <Text key={key} style={[styles.listItem, { color: colors.ink }]}>
                ⚠ {signLabel(key, warningSignDefs, recoverySignDefs)}
              </Text>
            ))}
            {recoveries.map((key) => (
              <Text key={key} style={[styles.listItem, { color: '#4d8a63' }]}>
                ✓ {signLabel(key, warningSignDefs, recoverySignDefs)}
              </Text>
            ))}
          </>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Boundaries</Text>
        {(sections.boundaries ?? []).length === 0 ? (
          <Text style={[styles.body, { color: colors.inkSoft }]}>None written.</Text>
        ) : (
          sections.boundaries.map((w, i) => (
            <Text key={i} style={[styles.listItem, { color: colors.ink }]}>
              🛡 {w.text}
            </Text>
          ))
        )}
      </View>

      {sections.loved_one ? (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>Loved one</Text>
          <Text style={[styles.body, { color: colors.ink }]}>
            {[
              sections.loved_one.first_name,
              sections.loved_one.relationship,
              sections.loved_one.stage,
              sections.loved_one.status,
            ]
              .filter(Boolean)
              .join(' · ')}
            {sections.loved_one.substances.length > 0
              ? `\nSubstances: ${sections.loved_one.substances.join(', ')}`
              : ''}
          </Text>
        </View>
      ) : null}

      {rehearsals.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>Recent practice</Text>
          {rehearsals.map((r, i) => (
            <Text key={i} style={[styles.listItem, { color: colors.ink }]}>
              {r.created_at}
              {r.scores
                ? ' — ' +
                  Object.entries(r.scores)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')
                : ''}
            </Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.replyBtn, { backgroundColor: colors.primary, opacity: openingThread ? 0.7 : 1 }]}
        onPress={openThread}
        disabled={openingThread}
        activeOpacity={0.85}
      >
        {openingThread ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.replyBtnText}>Reply in their thread</Text>
        )}
      </TouchableOpacity>
      <Text style={[styles.replyNote, { color: colors.inkSoft }]}>
        Opening the thread marks this brief replied. Your message lands in their in-app messages with a push.
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 48 },
  backRow: { marginBottom: 12 },
  backText: { fontSize: 15 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  meta: { fontSize: 12.5, marginTop: 4 },
  bandRow: { flexDirection: 'row', marginTop: 12 },
  bandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  bandDot: { width: 9, height: 9, borderRadius: 5 },
  bandPillText: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 14 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  noteText: { fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  moodRow: { fontSize: 13, lineHeight: 21, fontVariant: ['tabular-nums'] },
  listItem: { fontSize: 14, lineHeight: 22 },
  replyBtn: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  replyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15.5 },
  replyNote: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 10 },
});
