import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { FreeTierPaywall } from '../src/components/ui/FreeTierPaywall';
import { isAdminEmail } from '../src/lib/admin';
import { supabase } from '../src/lib/supabase';
import type { PartnerDebrief, PartnerTurn } from '../src/hooks/useRehearsalPartner';

type SessionRow = {
  id: string;
  created_at: string;
  scenario: {
    relationship?: string;
    temperament?: string;
    partnerName?: string;
  } | null;
  transcript: PartnerTurn[] | null;
  debrief: PartnerDebrief | null;
};

const SCORE_KEYS = ['love', 'ask', 'boundaries', 'calm'] as const;

export default function RehearsalHistoryScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('rehearsalLive');
  const router = useRouter();
  const { user, accountState } = useAccount();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('rehearsal_sessions')
      .select('id, created_at, scenario, transcript, debrief')
      .eq('account_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setSessions((data as SessionRow[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmDelete(id: string) {
    Alert.alert(t('history.deleteTitle'), t('history.deleteBody'), [
      { text: t('history.deleteCancel'), style: 'cancel' },
      {
        text: t('history.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          void supabase.from('rehearsal_sessions').delete().eq('id', id).then(() => {
            setSessions((prev) => prev.filter((s) => s.id !== id));
          });
        },
      },
    ]);
  }

  if (accountState === 'direct-free' && !isAdminEmail(user?.email)) {
    return <FreeTierPaywall />;
  }

  return (
    <ScreenContainer backgroundColor={colors.ink}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
        <Text style={[styles.backText, { color: colors.inkSoft }]}>‹ {t('history.title')}</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>{t('history.title')}</Text>
      <Text style={[styles.subheading, { color: colors.inkSoft }]}>{t('history.subtitle')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.inkSoft} style={styles.loader} />
      ) : sessions.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.primaryDark }]}>
          <Text style={[styles.emptyText, { color: colors.inkSoft }]}>{t('history.empty')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {sessions.map((session) => {
            const expanded = expandedId === session.id;
            const temperamentKey = session.scenario?.temperament ?? 'guarded';
            const date = new Date(session.created_at).toLocaleDateString(
              i18n.language?.startsWith('es') ? 'es' : 'en-US',
              { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
            );
            return (
              <View key={session.id} style={[styles.card, { backgroundColor: colors.primaryDark }]}>
                <TouchableOpacity
                  onPress={() => setExpandedId(expanded ? null : session.id)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderText}>
                      <Text style={[styles.cardTitle, { color: colors.white }]}>
                        {t(`temperaments.${temperamentKey}.title`)}
                        {session.scenario?.relationship
                          ? ` · ${t(`relationships.${session.scenario.relationship}`, { defaultValue: session.scenario.relationship })}`
                          : ''}
                      </Text>
                      <Text style={[styles.cardDate, { color: colors.inkSoft }]}>{date}</Text>
                    </View>
                    <Text style={[styles.chevron, { color: colors.inkSoft }]}>{expanded ? '▾' : '▸'}</Text>
                  </View>
                  {session.debrief?.scores && (
                    <View style={styles.scoreRow}>
                      {SCORE_KEYS.map((key) => (
                        <View key={key} style={[styles.scorePill, { backgroundColor: colors.ink }]}>
                          <Text style={[styles.scoreValue, { color: colors.white }]}>
                            {session.debrief?.scores?.[key] ?? '–'}
                          </Text>
                          <Text style={[styles.scoreLabel, { color: colors.inkSoft }]} numberOfLines={1}>
                            {t(`debrief.scores.${key}`)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>

                {expanded && (
                  <View style={styles.expandArea}>
                    {(session.transcript ?? []).map((turn, i) => (
                      <View
                        key={i}
                        style={[
                          styles.bubble,
                          turn.role === 'user'
                            ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                            : [styles.bubblePartner, { backgroundColor: colors.ink }],
                        ]}
                      >
                        <Text style={styles.bubbleText}>{turn.text}</Text>
                      </View>
                    ))}

                    {session.debrief && (
                      <View style={[styles.debriefBox, { borderColor: colors.inkSoft }]}>
                        {session.debrief.wentWell?.map((item, i) => (
                          <Text key={`w${i}`} style={[styles.debriefItem, { color: colors.white }]}>
                            ✓  {item}
                          </Text>
                        ))}
                        {session.debrief.workOn?.map((item, i) => (
                          <Text key={`o${i}`} style={[styles.debriefItem, { color: colors.white }]}>
                            →  {item}
                          </Text>
                        ))}
                        {!!session.debrief.drill && (
                          <Text style={[styles.debriefDrill, { color: colors.inkSoft }]}>
                            {t('debrief.drillLabel')}: {session.debrief.drill}
                          </Text>
                        )}
                      </View>
                    )}

                    <TouchableOpacity onPress={() => confirmDelete(session.id)} style={styles.deleteBtn} hitSlop={8}>
                      <Text style={[styles.deleteText, { color: colors.coral }]}>{t('history.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
          <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>{t('history.privacyNote')}</Text>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backRow: { marginBottom: 16 },
  backText: { fontSize: 15 },
  heading: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  loader: { marginTop: 40 },
  emptyCard: { borderRadius: 16, padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  card: { borderRadius: 16, padding: 16, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardDate: { fontSize: 12, marginTop: 2 },
  chevron: { fontSize: 16, marginLeft: 8 },
  scoreRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  scorePill: { flex: 1, borderRadius: 10, paddingVertical: 6, alignItems: 'center' },
  scoreValue: { fontWeight: '700', fontSize: 14 },
  scoreLabel: { fontSize: 8, marginTop: 1 },
  expandArea: { marginTop: 14 },
  bubble: { borderRadius: 12, padding: 10, marginBottom: 6, maxWidth: '90%' },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 3 },
  bubblePartner: { alignSelf: 'flex-start', borderBottomLeftRadius: 3 },
  bubbleText: { color: '#fff', fontSize: 13, lineHeight: 19 },
  debriefBox: { borderTopWidth: 1, marginTop: 8, paddingTop: 12 },
  debriefItem: { fontSize: 13, lineHeight: 20, marginBottom: 6 },
  debriefDrill: { fontSize: 12, lineHeight: 18, marginTop: 4, fontStyle: 'italic' },
  deleteBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  deleteText: { fontSize: 13, fontWeight: '600' },
  privacyNote: { fontSize: 10, textAlign: 'center', lineHeight: 15, marginVertical: 12 },
});
