import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { Gate } from '../src/components/auth/Gate';
import { supabase } from '../src/lib/supabase';
import { appAlert } from '../src/lib/appAlert';
import { DeliverySummary } from '../src/components/rehearsal/DeliverySummary';
import { ScoreTrendChart } from '../src/components/rehearsal/ScoreTrendChart';
import { readDeliveryReport } from '../src/lib/practiceDelivery';
import { scoreTrend, SCORE_KEYS } from '../src/lib/practiceTrends';
import { INCOMING_PRESETS, PRACTICE_SITUATIONS } from '../src/lib/practiceScenarios';
import type { PartnerDebrief } from '../src/hooks/useRehearsalPartner';

// Every dialog here goes through appAlert (react-native-web's Alert.alert is
// a no-op). Kept under the `Alert` name the screen-audit test substitutes.
const Alert = { alert: appAlert };

type SessionRow = {
  id: string;
  created_at: string;
  scenario: {
    relationship?: string;
    temperament?: string;
    partnerName?: string;
    mode?: string;
    situation?: string;
    crisisPreset?: string;
    warmup?: boolean;
    practiceSource?: string;
    speakers?: unknown[];
    redoFromTurn?: number;
  } | null;
  transcript: { role: string; text: string; speaker?: string }[] | null;
  debrief: PartnerDebrief | null;
};

/** Short labels under each card's title: what kind of rep this was. */
function sessionTags(scenario: SessionRow['scenario']): string[] {
  if (!scenario) return [];
  const tags: string[] = [];
  if (scenario.warmup) tags.push('warmup');
  if (Array.isArray(scenario.speakers) && scenario.speakers.length >= 2) tags.push('family');
  if (scenario.practiceSource === 'letter' || scenario.practiceSource === 'invitation') tags.push(scenario.practiceSource);
  if (typeof scenario.redoFromTurn === 'number') tags.push('redo');
  return tags;
}

export default function RehearsalHistoryScreen() {
  return <Gate feature="aiRehearsal"><RehearsalHistoryContent /></Gate>;
}

function RehearsalHistoryContent() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('rehearsalLive');
  const router = useRouter();
  const { user } = useAccount();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loadRequest = useRef(0);
  const trend = useMemo(() => scoreTrend(sessions), [sessions]);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoadError(false);
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('rehearsal_sessions')
        .select('id, created_at, scenario, transcript, debrief')
        .eq('account_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (request === loadRequest.current) setSessions((data as SessionRow[]) ?? []);
    } catch {
      if (request === loadRequest.current) setLoadError(true);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setSessions([]);
    setExpandedId(null);
    void load();
    return () => { ++loadRequest.current; };
  }, [load]);

  function confirmDelete(id: string) {
    Alert.alert(t('history.deleteTitle'), t('history.deleteBody'), [
      { text: t('history.deleteCancel'), style: 'cancel' },
      {
        text: t('history.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('rehearsal_sessions').delete().eq('id', id);
            if (error) throw error;
            setSessions((prev) => prev.filter((s) => s.id !== id));
          } catch {
            Alert.alert(t('history.deleteError'));
          }
        },
      },
    ]);
  }


  return (
    <ScreenContainer backgroundColor={colors.ink}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12} accessibilityRole="button">
        <Text style={[styles.backText, { color: colors.inkSoft }]}>‹ {t('history.title')}</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>{t('history.title')}</Text>
      <Text style={[styles.subheading, { color: colors.inkSoft }]}>{t('history.subtitle')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.inkSoft} style={styles.loader} />
      ) : loadError ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.primaryDark }]}>
          <Text accessibilityRole="alert" style={[styles.emptyText, { color: colors.inkSoft }]}>
            {t('history.loadError')}
          </Text>
          <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={styles.deleteBtn}>
            <Text style={{ color: colors.white }}>{t('common:accountLoad.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : sessions.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.primaryDark }]}>
          <Text style={[styles.emptyText, { color: colors.inkSoft }]}>{t('history.empty')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <ScoreTrendChart trend={trend} />
          {sessions.map((session) => {
            const expanded = expandedId === session.id;
            const temperamentKey = session.scenario?.temperament ?? 'guarded';
            const situationKey = session.scenario?.mode === 'incoming_call'
              ? null
              : (PRACTICE_SITUATIONS as readonly string[]).includes(session.scenario?.situation ?? '')
                ? session.scenario?.situation
                : null;
            const presetKey = session.scenario?.mode === 'incoming_call' &&
              (INCOMING_PRESETS as readonly string[]).includes(session.scenario?.crisisPreset ?? '')
              ? session.scenario?.crisisPreset
              : null;
            const tags = sessionTags(session.scenario);
            const delivery = readDeliveryReport((session.debrief as { delivery?: unknown } | null)?.delivery);
            const date = new Date(session.created_at).toLocaleDateString(
              i18n.language?.startsWith('es') ? 'es' : 'en-US',
              { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
            );
            return (
              <View key={session.id} style={[styles.card, { backgroundColor: colors.primaryDark }]}>
                <TouchableOpacity
                  onPress={() => setExpandedId(expanded ? null : session.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
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
                      {(situationKey || presetKey || tags.length > 0) && (
                        <Text style={[styles.cardTags, { color: colors.inkSoft }]} numberOfLines={2}>
                          {[
                            situationKey ? t(`situations.${situationKey}`) : null,
                            presetKey ? t(`history.presets.${presetKey}`) : null,
                            ...tags.map((tag) => t(`history.tags.${tag}`)),
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      )}
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
                        {turn.role === 'user' && !!turn.speaker && (
                          <Text style={[styles.speakerTag, { color: colors.primaryLight }]}>{turn.speaker}</Text>
                        )}
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
                        {delivery && (
                          <View style={styles.deliveryBox}>
                            <Text style={[styles.deliveryTitle, { color: colors.secondary }]}>{t('debrief.delivery.title')}</Text>
                            <DeliverySummary report={delivery} compact />
                          </View>
                        )}
                      </View>
                    )}

                    <TouchableOpacity onPress={() => confirmDelete(session.id)} style={styles.deleteBtn} hitSlop={8} accessibilityRole="button">
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
  cardTags: { fontSize: 11, marginTop: 3 },
  speakerTag: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  deliveryBox: { marginTop: 10 },
  deliveryTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
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
