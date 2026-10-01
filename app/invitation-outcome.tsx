import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Gate } from '../src/components/auth/Gate';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useInvitationEngine } from '../src/hooks/useInvitationEngine';
import { SafetyFirstPanel } from '../src/components/invitation/SafetyFirstPanel';
import { BackLink, EngineCard, Kicker, PrimaryButton, TextLink } from '../src/components/invitation/ui';
import { logInvitationAttempt } from '../src/lib/invitationApi';
import { formatLocalDate } from '../src/lib/invitationCopy';
import { isSafetyFirst, localClock } from '../src/lib/invitationEngine';
import {
  ASK_DAYS,
  askDate,
  INVITATION_OUTCOMES,
  isLineStyleChoice,
  LINE_STYLE_CHOICES,
  OUTCOME_NOTE_MAX,
  repairPlanKeys,
  suggestNextWindowDate,
  type AskDay,
  type InvitationOutcome,
  type LineStyleChoice,
} from '../src/lib/invitationOutcomes';
import { captureAppError } from '../src/lib/monitoring';

export default function InvitationOutcomeScreen() {
  const { user } = useAccount();
  return (
    <Gate feature="invitationEngine">
      <InvitationOutcomeContent key={user?.id ?? 'signed-out'} />
    </Gate>
  );
}

/**
 * The outcome loop: one tap records how the invitation went. "Yes" goes
 * straight into the Treatment Action Plan's They Said Yes mode (and alerts
 * Matt server-side); "not yet"/"angry" get a short repair plan and the next
 * suggested window.
 */
function InvitationOutcomeContent() {
  const { user } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('invitation');
  const router = useRouter();
  const params = useLocalSearchParams<{ style?: string }>();
  const engine = useInvitationEngine(user?.id ?? null, user?.timezone);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [lineStyle, setLineStyle] = useState<LineStyleChoice | null>(
    isLineStyleChoice(params.style) ? params.style : null,
  );
  const [askedOn, setAskedOn] = useState<AskDay>('today');
  const [saving, setSaving] = useState<InvitationOutcome | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [logged, setLogged] = useState<{ outcome: InvitationOutcome; nextWindowDate: string | null } | null>(null);

  async function log(outcome: InvitationOutcome) {
    if (saving) return;
    setSaving(outcome);
    setSaveError(false);
    const snapshot = engine.snapshot;
    const today = snapshot?.localDate ?? localClock(new Date(), user?.timezone).date;
    const localDate = askDate(today, askedOn);
    try {
      const saved = await logInvitationAttempt({
        outcome,
        localDate,
        note,
        // Only a fallback: the server uses the forecast recorded for the ask day.
        forecast: askedOn === 'today' ? engine.forecast : null,
        lineStyle,
        nextWindowDate: suggestNextWindowDate(outcome, localDate, snapshot?.plan.soberTimes ?? []),
      });
      if (outcome === 'yes') {
        router.replace({
          pathname: '/treatment-action-plan',
          // Tell the plan screen whether Matt was actually alerted, so it never claims he was.
          params: { focus: 'yes', source: 'invitation', alerted: saved.coachAlerted ? '1' : '0' },
        } as never);
        return;
      }
      setLogged({ outcome, nextWindowDate: saved.nextWindowDate });
    } catch (error) {
      captureAppError(error);
      setSaveError(true);
    } finally {
      setSaving(null);
    }
  }

  if (logged) {
    return (
      <ScreenContainer contentContainerStyle={styles.wrap}>
        <BackLink label={t('common.back')} onPress={() => router.back()} />
        <EngineCard tone="warm">
          <Kicker>{t('outcome.kicker')}</Kicker>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t(`outcome.repairTitles.${logged.outcome}`)}</Text>
          {repairPlanKeys(logged.outcome).map((key, index) => (
            <View key={key} style={styles.stepRow}>
              <Text style={[styles.stepNumber, { color: colors.primary }]}>{index + 1}</Text>
              <Text style={[styles.stepText, { color: colors.ink }]}>{t(key)}</Text>
            </View>
          ))}
          {logged.nextWindowDate && (
            <View style={[styles.window, { borderColor: colors.primary, backgroundColor: colors.white }]}>
              <Text style={[styles.windowLabel, { color: colors.inkSoft }]}>{t('outcome.nextWindowLabel').toUpperCase()}</Text>
              <Text style={[styles.windowDate, { color: colors.primary }]}>
                {formatLocalDate(logged.nextWindowDate, i18n.language)}
              </Text>
            </View>
          )}
          {logged.outcome === 'angry' && (
            <Text accessibilityRole="alert" style={[styles.safety, { color: colors.coral }]}>{t('outcome.angrySafety')}</Text>
          )}
        </EngineCard>
        <PrimaryButton label={t('outcome.backToEngine')} onPress={() => router.dismissTo('/invitation-engine' as never)} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <BackLink label={t('common.back')} onPress={() => router.back()} />
      {isSafetyFirst(engine.snapshot) && (
        <SafetyFirstPanel />
      )}
      <Kicker>{t('outcome.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('outcome.title')}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t('outcome.body')}</Text>

      <Text style={[styles.label, { color: colors.ink }]}>{t('outcome.whenLabel')}</Text>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {ASK_DAYS.map((day) => {
          const selected = askedOn === day;
          return (
            <TouchableOpacity
              key={day}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`outcome.when.${day}`)}
              onPress={() => setAskedOn(day)}
              style={[styles.chip, {
                borderColor: selected ? colors.primary : colors.line,
                backgroundColor: selected ? colors.primaryLight : colors.white,
              }]}
            >
              <Text style={[styles.chipText, { color: selected ? colors.primary : colors.ink }]}>{t(`outcome.when.${day}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.ink }]}>{t('outcome.styleLabel')}</Text>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {LINE_STYLE_CHOICES.map((style) => {
          const selected = lineStyle === style;
          return (
            <TouchableOpacity
              key={style}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`outcome.style.${style}`)}
              onPress={() => setLineStyle(selected ? null : style)}
              style={[styles.chip, {
                borderColor: selected ? colors.primary : colors.line,
                backgroundColor: selected ? colors.primaryLight : colors.white,
              }]}
            >
              <Text style={[styles.chipText, { color: selected ? colors.primary : colors.ink }]}>{t(`outcome.style.${style}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showNote ? (
        <>
          <Text style={[styles.label, { color: colors.ink }]}>{t('outcome.noteLabel')}</Text>
          <TextInput
            accessibilityLabel={t('outcome.noteLabel')}
            multiline
            value={note}
            onChangeText={setNote}
            maxLength={OUTCOME_NOTE_MAX}
            placeholder={t('outcome.notePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={[styles.note, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white }]}
          />
        </>
      ) : (
        <TextLink label={t('outcome.noteLabel')} onPress={() => setShowNote(true)} />
      )}

      <View style={styles.options}>
        {INVITATION_OUTCOMES.map((outcome) => {
          const tint = outcome === 'yes' ? colors.green : outcome === 'angry' ? colors.coral : colors.primary;
          const busy = saving === outcome;
          return (
            <TouchableOpacity
              key={outcome}
              accessibilityRole="button"
              accessibilityLabel={`${t(`outcome.options.${outcome}`)}. ${t(`outcome.optionBody.${outcome}`)}`}
              accessibilityState={{ disabled: !!saving, busy }}
              disabled={!!saving}
              onPress={() => { void log(outcome); }}
              style={[styles.option, {
                borderColor: tint,
                backgroundColor: outcome === 'yes' ? colors.greenLight : colors.white,
                opacity: saving && !busy ? 0.6 : 1,
              }]}
            >
              <Text style={[styles.optionTitle, { color: tint }]}>
                {busy ? t('common.saving') : t(`outcome.options.${outcome}`)}
              </Text>
              <Text style={[styles.optionBody, { color: colors.inkSoft }]}>{t(`outcome.optionBody.${outcome}`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {saveError && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('outcome.saveError')}</Text>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '900' },
  body: { fontSize: 14.5, lineHeight: 21, marginTop: 6 },
  label: { fontSize: 13.5, fontWeight: '800', marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, minHeight: 42, paddingHorizontal: 13, justifyContent: 'center' },
  chipText: { fontSize: 13.5, fontWeight: '700' },
  note: { minHeight: 84, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 21, marginTop: 8, textAlignVertical: 'top' },
  options: { gap: 10, marginTop: 18 },
  option: { borderWidth: 2, borderRadius: 16, padding: 15, minHeight: 64 },
  optionTitle: { fontSize: 17.5, fontWeight: '900' },
  optionBody: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  error: { fontSize: 13, fontWeight: '700', marginTop: 12 },
  stepRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stepNumber: { fontSize: 16, fontWeight: '900', width: 18 },
  stepText: { flex: 1, fontSize: 15, lineHeight: 22 },
  window: { borderWidth: 1.5, borderRadius: 14, padding: 13, marginTop: 16 },
  windowLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  windowDate: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  safety: { fontSize: 13.5, lineHeight: 19, fontWeight: '800', marginTop: 14 },
});
