import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Gate } from '../src/components/auth/Gate';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useInvitationEngine } from '../src/hooks/useInvitationEngine';
import { useLovedOneProfile } from '../src/hooks/useLovedOneProfile';
import { useTreatmentActionPlan } from '../src/hooks/useTreatmentActionPlan';
import { CrisisResourcesPanel } from '../src/components/invitation/CrisisResourcesPanel';
import { SafetyFirstPanel } from '../src/components/invitation/SafetyFirstPanel';
import {
  BackLink,
  EngineCard,
  Kicker,
  PrimaryButton,
  SecondaryButton,
} from '../src/components/invitation/ui';
import { draftInvitationLines } from '../src/lib/invitationApi';
import { afterObservationEdit, kitCrisisState, type KitAcknowledgement, type ServerCrisis } from '../src/lib/invitationKitScreen';
import { stashPracticeText } from '../src/lib/practiceHandoffAuth';
import { isSafetyFirst } from '../src/lib/invitationEngine';
import {
  kitPracticeText,
  LINE_STYLES,
  lineNeedsSoftening,
  OBSERVATION_MAX,
  practiceNeedsHandoff,
  renderTemplateLine,
  templateLines,
  type LineStyle,
} from '../src/lib/invitationLines';

export default function InvitationKitScreen() {
  const { user } = useAccount();
  return (
    <Gate feature="invitationEngine">
      <InvitationKitContent key={user?.id ?? 'signed-out'} />
    </Gate>
  );
}

type KitLine = { text: string; source: 'template' | 'ai' | 'edited' };
type Notice = 'ai' | 'unavailable' | 'limit' | null;

function InvitationKitContent() {
  const { user } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('invitation');
  const router = useRouter();
  const accountId = user?.id ?? null;
  const engine = useInvitationEngine(accountId, user?.timezone);
  const { profile, reload: reloadProfile } = useLovedOneProfile(accountId);
  const actionPlan = useTreatmentActionPlan(accountId);

  const program = actionPlan.hydrated ? actionPlan.plan.placementDetails.programName.trim() : '';
  const phone = actionPlan.hydrated ? actionPlan.plan.execution.admissionsPhone.trim() : '';
  const name = profile?.name?.trim() ?? '';

  const [observation, setObservation] = useState('');
  const [lines, setLines] = useState<Record<LineStyle, KitLine>>(() => ({
    warm: { text: '', source: 'template' },
    observation: { text: '', source: 'template' },
    help: { text: '', source: 'template' },
  }));
  const [chosen, setChosen] = useState<LineStyle | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // What the server's crisis screen reported when it caught something the
  // app's twin did not (patterns or moderation). Each response is a new hit.
  const [serverCrisis, setServerCrisis] = useState<ServerCrisis | null>(null);
  const serverHits = useRef(0);
  // "I'm safe right now" for exactly the hits on screen, this visit only —
  // with the observation and next step as they were when she tapped it, so
  // the server still screens anything she types afterwards.
  const [acknowledgement, setAcknowledgement] = useState<KitAcknowledgement | null>(null);

  // Back from "Edit your map" (or anywhere): re-read the map and start the
  // crisis screen fresh — a new visit never inherits an acknowledgement.
  useFocusEffect(useCallback(() => {
    void reloadProfile();
    setServerCrisis(null);
    setAcknowledgement(null);
  }, [reloadProfile]));

  // Screened before any line is shown, with the same combined check the coach
  // runs over every free-text field that would reach it: violence, threats,
  // weapons or self-harm means crisis resources, not invitation lines. Her
  // stored safety answer is unchanged.
  const screenInput = useMemo(() => ({
    observation,
    next_step: program,
    recent_incidents: profile?.recentIncidents,
    usual_phrases: profile?.usualPhrases,
    costs_they_feel: profile?.costsTheyFeel,
    what_use_gives: profile?.whatUseGives,
    sober_moments: profile?.soberMoments,
    use_triggers: profile?.useTriggers,
  }), [observation, program, profile]);
  // Keyed to the texts that tripped and the server response (not every
  // keystroke in the observation). Pattern and moderation hits alike.
  const { field: crisisField, key: crisisKey, acknowledged } = useMemo(
    () => kitCrisisState(screenInput, serverCrisis, acknowledgement?.key ?? null),
    [screenInput, serverCrisis, acknowledgement],
  );
  const crisis = crisisField !== null;

  function changeObservation(text: string) {
    setObservation(text);
    // Editing the observation resolves a server hit (either source) that was in the observation.
    setServerCrisis(afterObservationEdit);
  }

  function acknowledgeSafe() {
    if (crisisKey) setAcknowledgement({ key: crisisKey, observation, nextStep: program });
  }

  const templates = useMemo(() => {
    const translate = (key: string, params?: Record<string, string>) => t(key, params);
    return Object.fromEntries(
      templateLines({ name, observation, program }).map((line) => [line.style, renderTemplateLine(line, translate)]),
    ) as Record<LineStyle, string>;
  }, [name, observation, program, t, i18n.language]);

  // Template lines follow the family's inputs until they edit or replace them.
  useEffect(() => {
    setLines((current) => {
      const next = { ...current };
      for (const style of LINE_STYLES) {
        if (current[style].source === 'template') next[style] = { text: templates[style], source: 'template' };
      }
      return next;
    });
  }, [templates]);

  async function personalize() {
    if (drafting) return;
    setDrafting(true);
    setNotice(null);
    const result = await draftInvitationLines({
      language: i18n.language,
      observation,
      nextStep: program,
      // Only her explicit "I'm safe right now" for exactly these hits sets
      // aside the server's crisis screen (patterns and moderation).
      acknowledgedCrisis: acknowledged,
      acknowledgedObservation: acknowledged ? acknowledgement?.observation : undefined,
      acknowledgedNextStep: acknowledged ? acknowledgement?.nextStep : undefined,
    });
    setDrafting(false);
    if (!result.ok) {
      if (result.code === 'crisis') {
        // A new hit: crisis resources first, then her "I'm safe right now".
        serverHits.current += 1;
        setServerCrisis({
          field: result.field ?? 'unknown',
          source: result.source === 'moderation' ? 'moderation' : 'patterns',
          id: serverHits.current,
        });
        setAcknowledgement(null);
        return;
      }
      setNotice(result.code === 'daily_limit_reached' ? 'limit' : 'unavailable');
      return;
    }
    setLines((current) => {
      const next = { ...current };
      for (const line of result.lines) next[line.style] = { text: line.text, source: 'ai' };
      return next;
    });
    setNotice('ai');
  }

  function rehearse(practiceText: string) {
    // The whole kit is several lines: hand it over in memory (only a short
    // token travels in the route). A single line can ride in the URL.
    if (accountId && practiceNeedsHandoff(practiceText)) {
      const handoff = stashPracticeText(practiceText, 'invitation', accountId);
      router.push({ pathname: '/rehearsal-live', params: { handoff, source: 'invitation' } } as never);
      return;
    }
    router.push({ pathname: '/rehearsal-live', params: { practiceText, source: 'invitation' } } as never);
  }

  const nextStepText = [
    program ? t('kit.program', { program }) : '',
    phone ? t('kit.phone', { phone }) : '',
  ].filter(Boolean).join(' · ');

  // Safety status must be known before any invitation line or rehearse button
  // appears: until the snapshot loads, unknown is treated as safety-first.
  if (!engine.snapshot) {
    return (
      <ScreenContainer contentContainerStyle={styles.wrap}>
        <BackLink label={t('common.back')} onPress={() => router.back()} />
        {engine.loadError ? (
          <EngineCard tone="alert">
            <Text accessibilityRole="alert" style={[styles.cardTitle, { color: colors.coral }]}>{t('common.loadErrorTitle')}</Text>
            <Text style={[styles.body, { color: colors.ink }]}>{t('common.loadErrorBody')}</Text>
            <PrimaryButton label={t('common.retry')} onPress={() => { void engine.reload(); }} />
          </EngineCard>
        ) : (
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
      </ScreenContainer>
    );
  }

  if (isSafetyFirst(engine.snapshot)) {
    return (
      <ScreenContainer contentContainerStyle={styles.wrap}>
        <BackLink label={t('common.back')} onPress={() => router.back()} />
        <SafetyFirstPanel />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <BackLink label={t('common.back')} onPress={() => router.back()} />
      <Kicker>{t('kit.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('kit.title')}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t('kit.body')}</Text>

      <EngineCard style={styles.section}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('kit.nextStepTitle')}</Text>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('kit.nextStepBody')}</Text>
        {actionPlan.loadState === 'loading' ? (
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.inkSoft }]}>{t('kit.planLoading')}</Text>
        ) : program || phone ? (
          <>
            {program ? <Text style={[styles.fact, { color: colors.ink }]}>{t('kit.program', { program })}</Text> : null}
            {phone ? <Text style={[styles.fact, { color: colors.ink }]}>{t('kit.phone', { phone })}</Text> : null}
            <SecondaryButton label={t('kit.openPlan')} onPress={() => router.push('/treatment-action-plan' as never)} />
          </>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.ink }]}>{t('kit.noPlanBody')}</Text>
            <SecondaryButton label={t('kit.findProgram')} onPress={() => router.push('/finder' as never)} />
            <SecondaryButton label={t('kit.openPlan')} onPress={() => router.push('/treatment-action-plan' as never)} />
          </>
        )}
      </EngineCard>

      <EngineCard>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('kit.linesTitle')}</Text>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('kit.linesBody')}</Text>
        {acknowledged && !crisis && (
          <Text accessibilityRole="alert" style={[styles.notice, { color: colors.coral }]}>{t('crisis.acknowledgedNote')}</Text>
        )}
        <Text style={[styles.label, { color: colors.ink }]}>{t('kit.observationLabel')}</Text>
        <TextInput
          accessibilityLabel={t('kit.observationLabel')}
          value={observation}
          onChangeText={changeObservation}
          placeholder={t('kit.observationPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          maxLength={OBSERVATION_MAX}
          style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
        />
        {!crisis && (
          <SecondaryButton
            label={drafting ? t('kit.personalizing') : t('kit.personalize')}
            disabled={drafting}
            onPress={() => { void personalize(); }}
          />
        )}
        {!crisis && notice && (
          <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: notice === 'ai' ? colors.green : colors.inkSoft }]}>
            {notice === 'ai' ? t('kit.aiNote') : notice === 'limit' ? t('kit.aiLimit') : t('kit.aiUnavailable')}
          </Text>
        )}

        {!crisis && LINE_STYLES.map((style) => {
          const line = lines[style];
          const selected = chosen === style;
          return (
            <View
              key={style}
              style={[styles.line, { borderColor: selected ? colors.primary : colors.line, backgroundColor: colors.white }]}
            >
              <Text style={[styles.lineStyle, { color: colors.inkSoft }]}>{t(`kit.style.${style}`).toUpperCase()}</Text>
              <TextInput
                accessibilityLabel={t('kit.lineA11y', { style: t(`kit.style.${style}`) })}
                multiline
                value={line.text}
                onChangeText={(text) => setLines((current) => ({ ...current, [style]: { text, source: 'edited' } }))}
                maxLength={400}
                style={[styles.lineInput, { color: colors.ink }]}
              />
              {lineNeedsSoftening(line.text) && (
                <Text style={[styles.notice, { color: colors.coral }]}>{t('kit.softenTip')}</Text>
              )}
              <View style={styles.lineActions}>
                <TouchableOpacity
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={selected ? t('kit.chosen') : t('kit.choose')}
                  onPress={() => setChosen(selected ? null : style)}
                  style={[styles.smallButton, { borderColor: colors.primary, backgroundColor: selected ? colors.primaryLight : colors.white }]}
                >
                  <Text style={[styles.smallButtonText, { color: colors.primary }]}>{selected ? t('kit.chosen') : t('kit.choose')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${t('kit.rehearse')}: ${t(`kit.style.${style}`)}`}
                  accessibilityState={{ disabled: !line.text.trim() }}
                  disabled={!line.text.trim()}
                  onPress={() => rehearse(line.text.trim())}
                  style={[styles.smallButton, { borderColor: colors.green }]}
                >
                  <Text style={[styles.smallButtonText, { color: colors.green }]}>{t('kit.rehearse')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </EngineCard>

      {crisisField && (
        <CrisisResourcesPanel
          field={crisisField}
          // A false positive is never a dead end, whichever screen raised it.
          onAcknowledge={acknowledgeSafe}
        />
      )}

      {!crisis && (
      <EngineCard>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('kit.warmupTitle')}</Text>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('kit.warmupBody')}</Text>
        <SecondaryButton
          label={t('kit.warmup')}
          color={colors.green}
          onPress={() => router.push({ pathname: '/rehearsal-live', params: { warmup: '1', source: 'invitation' } } as never)}
        />
        <SecondaryButton
          label={t('kit.rehearseAll')}
          onPress={() => rehearse(kitPracticeText(LINE_STYLES.map((style) => lines[style].text), nextStepText))}
        />
      </EngineCard>
      )}

      <EngineCard tone="warm">
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('kit.tipsTitle')}</Text>
        {(['1', '2', '3', '4'] as const).map((tip) => (
          <Text key={tip} style={[styles.tip, { color: colors.ink }]}>• {t(`kit.tips.${tip}`)}</Text>
        ))}
      </EngineCard>

      <PrimaryButton
        label={t('kit.log')}
        onPress={() => router.push({ pathname: '/invitation-outcome', params: { style: chosen ?? '' } } as never)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  loading: { paddingVertical: 48 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  section: { marginTop: 14 },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
  fact: { fontSize: 15, lineHeight: 22, fontWeight: '800', marginTop: 8 },
  label: { fontSize: 13.5, fontWeight: '800', marginTop: 14 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, marginTop: 7 },
  notice: { fontSize: 12.5, lineHeight: 18, marginTop: 8, fontWeight: '700' },
  line: { borderWidth: 1.5, borderRadius: 14, padding: 13, marginTop: 14 },
  lineStyle: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1 },
  lineInput: { fontSize: 16, lineHeight: 23, fontWeight: '600', marginTop: 6, minHeight: 70, textAlignVertical: 'top' },
  lineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallButton: { borderWidth: 1.5, borderRadius: 999, minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' },
  smallButtonText: { fontSize: 13.5, fontWeight: '800' },
  tip: { fontSize: 14, lineHeight: 21, marginTop: 7 },
});
