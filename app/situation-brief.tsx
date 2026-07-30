import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useSituationBrief } from '../src/hooks/useSituationBrief';
import {
  briefMoodAverage,
  signLabel,
  type BriefStatus,
} from '../src/lib/situationBrief';
import type { SituationBand } from '../src/lib/situation';

type Phase = 'compose' | 'sent' | 'tooSoon';

type TrackerSignDef = { id: string; label: string; category: string };

const BAND_COLOR: Record<SituationBand, string> = {
  calm: '#4d8a63',
  watch: '#e6c070',
  elevated: '#c4604f',
  crisis: '#c4604f',
};

export default function SituationBriefScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('brief');
  const { t: tTracker } = useTranslation('tracker');
  const router = useRouter();
  const { user } = useAccount();
  const { preview, briefs, loading, sending, send } = useSituationBrief(user?.id ?? null);

  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('compose');

  const warningSignDefs = useMemo(
    () => tTracker('warning.signs', { returnObjects: true }) as TrackerSignDef[],
    [tTracker],
  );
  const recoverySignDefs = useMemo(
    () => tTracker('recovery.signs', { returnObjects: true }) as TrackerSignDef[],
    [tTracker],
  );

  const sections = preview?.sections ?? null;
  const situation = preview?.situation ?? null;
  const band: SituationBand = situation?.band ?? 'calm';
  const bandColor = BAND_COLOR[band];

  const warnings = useMemo(
    () => (sections?.tracker ?? []).filter((s) => s.kind === 'warning'),
    [sections],
  );
  const recoveries = useMemo(
    () => (sections?.tracker ?? []).filter((s) => s.kind === 'recovery'),
    [sections],
  );
  const uniqueWarningKeys = useMemo(
    () => [...new Set(warnings.map((w) => w.sign_key))],
    [warnings],
  );
  const moodAvg = sections ? briefMoodAverage(sections.mood) : null;
  const lowDays = (sections?.mood ?? []).filter((m) => m.mood <= 2).length;
  const latestReplied = briefs.find((b) => b.status === 'replied');

  async function handleSend() {
    const result = await send(note);
    if (result.ok) {
      setPhase('sent');
    } else if (result.code === 'too_soon') {
      setPhase('tooSoon');
    }
    // generic errors keep the compose phase; the button stays available
  }

  function statusLabel(status: BriefStatus): string {
    return t(`status.${status}`);
  }

  if (loading) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll backgroundColor={colors.cream} contentContainerStyle={styles.inner}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
        <Text style={[styles.backText, { color: colors.primary }]}>‹ {t('title')}</Text>
      </TouchableOpacity>

      {phase === 'sent' ? (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sentTitle, { color: colors.ink }]}>{t('sentTitle')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('sentBody')}</Text>
          <TouchableOpacity onPress={() => router.push('/chat')} style={styles.linkRow}>
            <Text style={[styles.linkText, { color: colors.primary }]}>{t('messagesLink')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {phase === 'tooSoon' ? (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.sentTitle, { color: colors.ink }]}>{t('tooSoonTitle')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('tooSoonBody')}</Text>
          <TouchableOpacity onPress={() => router.push('/chat')} style={styles.linkRow}>
            <Text style={[styles.linkText, { color: colors.primary }]}>{t('messagesLink')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {phase === 'compose' && (
        <>
          <Text style={[styles.eyebrow, { color: colors.coral }]}>{t('eyebrow')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('intro')}</Text>

          {/* ── Situation ── */}
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('sections.situation')}</Text>
            <View style={styles.bandRow}>
              <View style={[styles.bandDot, { backgroundColor: bandColor }]} />
              <Text style={[styles.bandText, { color: colors.ink }]}>
                {t(`situationLine.${band}`)}
                {situation?.sustained ? `  ·  ${t('situationLine.sustainedTag')}` : ''}
              </Text>
            </View>
          </View>

          {/* ── Mood ── */}
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('sections.mood')}</Text>
            {sections && sections.mood.length > 0 ? (
              <Text style={[styles.body, { color: colors.inkSoft }]}>
                {t('moodSummary', {
                  total: sections.mood.length,
                  avg: moodAvg ?? '—',
                  lowDays,
                })}
              </Text>
            ) : (
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('moodEmpty')}</Text>
            )}
          </View>

          {/* ── Warning signs ── */}
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('sections.warnings')}</Text>
            {uniqueWarningKeys.length > 0 ? (
              uniqueWarningKeys.map((key) => (
                <Text key={key} style={[styles.listItem, { color: colors.ink }]}>
                  ⚠ {signLabel(key, warningSignDefs, recoverySignDefs)}
                </Text>
              ))
            ) : (
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('trackerEmpty')}</Text>
            )}
            {recoveries.length > 0 && (
              <Text style={[styles.recoveryLine, { color: colors.inkSoft }]}>
                {t('sections.recovery')}: {[...new Set(recoveries.map((r) => r.sign_key))].length}
              </Text>
            )}
          </View>

          {/* ── Boundaries ── */}
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('sections.boundaries')}</Text>
            {sections && sections.boundaries.length > 0 ? (
              sections.boundaries.map((w, i) => (
                <Text key={i} style={[styles.listItem, { color: colors.ink }]}>
                  🛡 {w.text}
                </Text>
              ))
            ) : (
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('boundariesEmpty')}</Text>
            )}
          </View>

          {/* ── Loved one ── */}
          {sections?.loved_one ? (
            <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('sections.lovedOne')}</Text>
              <Text style={[styles.body, { color: colors.inkSoft }]}>
                {[
                  sections.loved_one.first_name,
                  sections.loved_one.relationship,
                  t(`lovedOneStatus.${sections.loved_one.status}` as never),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.previewNote, { color: colors.inkSoft }]}>{t('previewNote')}</Text>

          {/* ── Note ── */}
          <Text style={[styles.noteLabel, { color: colors.ink }]}>{t('noteLabel')}</Text>
          <TextInput
            style={[
              styles.noteInput,
              { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white },
            ]}
            value={note}
            onChangeText={setNote}
            placeholder={t('notePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
          />

          <Text style={[styles.consent, { color: colors.inkSoft }]}>{t('consent')}</Text>

          {preview?.can_send === false ? (
            <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.sentTitle, { color: colors.ink }]}>{t('tooSoonTitle')}</Text>
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('tooSoonBody')}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.coral, opacity: sending ? 0.7 : 1 }]}
              onPress={handleSend}
              disabled={sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>{t('sendButton')}</Text>
              )}
            </TouchableOpacity>
          )}

          <Text style={[styles.crisisNote, { color: colors.inkSoft }]}>{t('crisisNote')}</Text>
        </>
      )}

      {/* ── History ── */}
      {briefs.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('historyTitle')}</Text>
          {latestReplied && (
            <TouchableOpacity onPress={() => router.push('/chat')} style={styles.linkRow}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('openMessages')}</Text>
            </TouchableOpacity>
          )}
          {briefs.map((b) => (
            <View key={b.id} style={[styles.historyRow, { borderTopColor: colors.line }]}>
              <Text style={[styles.historyDate, { color: colors.ink }]}>
                {new Date(b.created_at).toLocaleDateString()}
              </Text>
              <Text
                style={[
                  styles.historyStatus,
                  { color: b.status === 'replied' ? '#4d8a63' : colors.inkSoft },
                ]}
              >
                {statusLabel(b.status)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 48 },
  backRow: { marginBottom: 16 },
  backText: { fontSize: 15 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { fontSize: 24, fontWeight: '700', marginTop: 6, marginBottom: 8, letterSpacing: -0.4 },
  body: { fontSize: 14, lineHeight: 20 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginTop: 14,
  },
  cardTitle: { fontSize: 14.5, fontWeight: '700', marginBottom: 8 },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bandDot: { width: 10, height: 10, borderRadius: 5 },
  bandText: { fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 20 },
  listItem: { fontSize: 14, lineHeight: 22 },
  recoveryLine: { fontSize: 12.5, marginTop: 8, fontStyle: 'italic' },
  previewNote: { fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 14 },
  noteLabel: { fontSize: 14.5, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  consent: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  sendBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 14,
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  crisisNote: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  sentTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  linkRow: { marginTop: 10 },
  linkText: { fontSize: 14, fontWeight: '600' },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    marginTop: 6,
  },
  historyDate: { fontSize: 13.5 },
  historyStatus: { fontSize: 13, fontWeight: '600' },
});
