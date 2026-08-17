import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { FreeTierPaywall } from '../src/components/ui/FreeTierPaywall';
import { Gate } from '../src/components/auth/Gate';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useDiyInterventionPlanner } from '../src/hooks/useDiyInterventionPlanner';
import { useTreatmentActionPlan } from '../src/hooks/useTreatmentActionPlan';

import {
  addDiyTeamMember,
  blankDiyLetter,
  DIY_LETTER_SECTION_LIMIT,
  DIY_TEAM_TEXT_LIMIT,
  DIY_TEXT_LIMIT,
  diyFitResult,
  diyInterventionProgress,
  diySolutionKey,
  diyStageAccess,
  removeDiyTeamMember,
  updateDiyLetter,
  updateDiyPlan,
  updateDiyTeamMember,
  type DiyAnswer,
  type DiyInterventionPlan,
  type DiyLevelOfCare,
  type DiyTeamRole,
} from '../src/lib/diyInterventionPlanner';
import { leaveTonightProgress, treatmentActionProgress } from '../src/lib/treatmentActionPlan';

const LEVELS: Exclude<DiyLevelOfCare, ''>[] = ['detox', 'residential', 'php', 'iop', 'outpatient'];
const ROLES: Exclude<DiyTeamRole, ''>[] = ['speaker', 'silent_support', 'not_in_room', 'on_call'];
const FIT_RISKS = ['recentViolence', 'weaponInHouse', 'activePsychosis', 'overdoseLastDay', 'childrenCannotExit'] as const;
const FIT_CAPABILITIES = ['familyUnitedOnOneSolution', 'canExecuteBasicsWithoutTutorial'] as const;

export default function DiyInterventionPlannerScreen() {
  return (
    <Gate
      feature="diyIntervention"
      fallback={<Shell><SafetyPanel /><FreeTierPaywall inline /></Shell>}
    >
      <DiyInterventionPlannerContent />
    </Gate>
  );
}

function DiyInterventionPlannerContent() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('diyInterventionPlanner');
  const { user } = useAccount();
  const accountId = user?.id ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => { clearInterval(interval); subscription.remove(); };
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const diy = useDiyInterventionPlanner(accountId);
  const tap = useTreatmentActionPlan(accountId);
  const tapProgress = useMemo(() => treatmentActionProgress(tap.plan), [tap.plan]);
  const leaveTonight = useMemo(() => leaveTonightProgress(tap.plan, now), [now, tap.plan]);
  const tapSnapshot = useMemo(() => ({
    hydrated: tap.hydrated,
    saveState: tap.saveState,
    logisticsReady: tapProgress.ready && leaveTonight.ready,
    dayOfRecordingReady: leaveTonight.completed === leaveTonight.total && leaveTonight.structuredReady,
    programName: tap.plan.placementDetails.programName,
    admissionsContactName: tap.plan.placementDetails.admissionsContactName,
    admissionsPhone: tap.plan.execution.admissionsPhone,
    bedConfirmedFor: tap.plan.placementDetails.bedConfirmedFor,
    bedConfirmationWindow: tap.plan.placementDetails.bedConfirmationWindow,
    bedConfirmedBy: tap.plan.placementDetails.bedConfirmedBy,
    bedReconfirmedAt: tap.plan.placementDetails.bedReconfirmedAt,
    departureAt: tap.plan.execution.departureAt,
    revision: tap.plan.updatedAt,
    logisticsFingerprint: JSON.stringify({ items: tap.plan.items, execution: tap.plan.execution }),
  }), [leaveTonight.ready, tap, tapProgress.ready]);
  const progress = useMemo(() => diyInterventionProgress(diy.plan, tapSnapshot, now), [diy.plan, now, tapSnapshot]);
  const access = useMemo(() => diyStageAccess(diy.plan, tapSnapshot, now), [diy.plan, now, tapSnapshot]);
  const fit = diyFitResult(diy.plan.fit);
  const solutionKey = diySolutionKey(diy.plan, tapSnapshot);
  const finalReady = progress.ready && diy.loadState === 'ready' && diy.saveState === 'saved';
  const update = (transform: (plan: DiyInterventionPlan) => DiyInterventionPlan) => diy.update(transform);

  function confirmClear() {
    Alert.alert(t('clearTitle'), t('clearBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clearConfirm'), style: 'destructive', onPress: () => void diy.clear().catch(() => undefined) },
    ]);
  }


  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <View style={[styles.hero, { backgroundColor: colors.primaryDark }]}>
        <Text style={styles.kicker}>{t('kicker')}</Text><Text style={styles.title}>{t('title')}</Text>
        <Text style={styles.intro}>{t('intro')}</Text><Text style={styles.privacy}>{t('privacy')}</Text>
      </View>
      <SafetyPanel />
      {diy.loadState === 'error' ? (
        <View accessibilityRole="alert" style={[styles.alert, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
          <Text style={[styles.stageTitle, { color: colors.coral }]}>{t('loadErrorTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('loadErrorBody')}</Text>
          <PrimaryButton label={t('retry')} onPress={() => void diy.reload()} />
          <TextButton label={t('startOver')} onPress={confirmClear} danger />
        </View>
      ) : diy.loadState !== 'ready' ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('loading')} />
      ) : (
        <>
          <View accessibilityRole="summary" style={[styles.readiness, { borderColor: finalReady ? colors.green : colors.coral, backgroundColor: finalReady ? colors.greenLight : colors.coralLight }]}>
            <Text style={[styles.stageTitle, { color: finalReady ? colors.green : colors.coral }]}>{finalReady ? t('readyTitle') : t('notReadyTitle')}</Text>
            <Text style={[styles.body, { color: colors.ink }]}>{finalReady ? t('readyBody') : t('notReadyBody')}</Text>
            <Text style={[styles.progress, { color: colors.ink }]}>{t('progress', progress)}</Text>
          </View>

          <StageCard title={t('stages.fit')} ready={progress.stages.fit.ready} locked={false}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('fit.body')}</Text>
            {[...FIT_RISKS, ...FIT_CAPABILITIES].map((key) => (
              <YesNoRow key={key} label={t(`fit.${key}` as never)} value={diy.plan.fit[key]} onChange={(value) => update((plan) => updateDiyPlan(plan, { fit: { ...plan.fit, [key]: value } }))} />
            ))}
            {fit.outcome === 'emergency' && <OffRamp title={t('fit.emergencyTitle')} body={t('fit.emergencyBody')} />}
            {fit.outcome === 'professional' && <OffRamp title={t('fit.professionalTitle')} body={t('fit.professionalBody')} />}
          </StageCard>

          <StageCard title={t('stages.care')} ready={progress.stages.care.ready} locked={!access.care}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('care.body')}</Text>
            {LEVELS.map((level) => <Text key={level} style={[styles.education, { color: colors.inkSoft }]}>{t(`care.education.${level}` as never)}</Text>)}
            <Label text={t('care.indicated')} />
            <ChoiceRow groupLabel={t('care.indicated')} values={LEVELS} selected={diy.plan.care.indicatedLevel} labels={(value) => t(`care.labels.${value}` as never)} onChange={(value) => update((plan) => updateDiyPlan(plan, { care: { ...plan.care, indicatedLevel: value } }))} />
            <Input label={t('care.why')} value={diy.plan.care.whyThisLevel} onChange={(value) => update((plan) => updateDiyPlan(plan, { care: { ...plan.care, whyThisLevel: value } }))} multiline />
            <Label text={t('care.temptation')} /><ChoiceRow groupLabel={t('care.temptation')} values={LEVELS} selected={diy.plan.care.acceptedPreferenceLevel} labels={(value) => t(`care.labels.${value}` as never)} onChange={(value) => update((plan) => updateDiyPlan(plan, { care: { ...plan.care, acceptedPreferenceLevel: value } }))} />
            <Text style={[styles.note, { color: colors.coral }]}>{t('care.temptationNote')}</Text>
            <Label text={t('care.plan')} /><ChoiceRow groupLabel={t('care.plan')} values={LEVELS} selected={diy.plan.care.planLevel} labels={(value) => t(`care.labels.${value}` as never)} onChange={(value) => update((plan) => updateDiyPlan(plan, { care: { ...plan.care, planLevel: value } }))} />
            {!!diy.plan.care.indicatedLevel && diy.plan.care.planLevel !== diy.plan.care.indicatedLevel && <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{t('care.gap')}</Text>}
          </StageCard>

          <StageCard title={t('stages.program')} ready={progress.stages.program.ready} locked={!access.program}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('program.body')}</Text>
            <Input label={t('program.date')} value={diy.plan.interventionDate} onChange={(value) => update((plan) => updateDiyPlan(plan, { interventionDate: value }))} />
            <Text style={[styles.summaryLine, { color: colors.ink }]}>{t('program.program', { value: tapSnapshot.programName || '—' })}</Text>
            <Text style={[styles.summaryLine, { color: colors.ink }]}>{t('program.contact', { name: tapSnapshot.admissionsContactName || '—', phone: tapSnapshot.admissionsPhone || '—' })}</Text>
            <Text style={[styles.summaryLine, { color: colors.ink }]}>{t('program.bed', { date: tapSnapshot.bedConfirmedFor || '—', window: tapSnapshot.bedConfirmationWindow || '—' })}</Text>
            <Text style={[styles.summaryLine, { color: colors.ink }]}>{t('program.confirmedBy', { value: tapSnapshot.bedConfirmedBy || '—' })}</Text>
            <Text style={[styles.summaryLine, { color: colors.ink }]}>{t('program.leave', { value: tapSnapshot.departureAt ? new Date(tapSnapshot.departureAt).toLocaleString() : '—' })}</Text>
            {!progress.stages.program.ready && <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{t('program.missing')}</Text>}
            <PrimaryButton label={t('program.tapButton')} onPress={() => router.push('/treatment-action-plan' as never)} />
            <TextButton label={t('program.finderButton')} onPress={() => router.push('/finder' as never)} />
            <Text style={[styles.note, { color: colors.inkSoft }]}>{t('program.finderNote')}</Text>
          </StageCard>

          <StageCard title={t('stages.team')} ready={progress.stages.team.ready} locked={!access.team}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('team.body')}</Text>
            {diy.plan.team.map((member) => (
              <View key={member.id} style={[styles.subcard, { borderColor: colors.line }]}>
                <Input label={t('team.name')} value={member.name} limit={DIY_TEAM_TEXT_LIMIT} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { name: value }))} />
                <Input label={t('team.relationship')} value={member.relationship} limit={DIY_TEAM_TEXT_LIMIT} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { relationship: value }))} />
                <Label text={t('team.role')} /><ChoiceRow groupLabel={`${member.name || t('team.name')} — ${t('team.role')}`} values={ROLES} selected={member.role} labels={(value) => t(`team.roles.${value}` as never)} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { role: value }))} />
                <BooleanRow label={t('team.activelyUsing')} value={member.activelyUsing} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { activelyUsing: value }))} />
                <BooleanRow label={t('team.competing')} value={member.offersCompetingPlan} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { offersCompetingPlan: value }))} />
                <BooleanRow label={t('team.child')} value={member.isChild} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { isChild: value }))} />
                <BooleanRow label={t('team.aligned')} value={member.aligned} onChange={(value) => update((plan) => updateDiyTeamMember(plan, member.id, { aligned: value }))} />
                <TextButton label={t('remove')} danger onPress={() => update((plan) => removeDiyTeamMember(plan, member.id))} />
              </View>
            ))}
            <PrimaryButton label={t('team.add')} onPress={() => update((plan) => addDiyTeamMember(plan))} />
            <Label text={t('team.undercutter')} />
            <ChoiceRow groupLabel={t('team.undercutter')} values={['none', 'named'] as const} selected={diy.plan.undercutter.answer} labels={(value) => t(value === 'none' ? 'team.undercutterNone' : 'team.undercutterNamed')} onChange={(value) => update((plan) => updateDiyPlan(plan, { undercutter: { answer: value, memberId: '', agreesToSolutionAndLeaveTime: value === 'none' ? true : null } }))} />
            {diy.plan.undercutter.answer === 'named' && <>
              <ChoiceRow groupLabel={t('team.undercutterNamed')} values={diy.plan.team.map((member) => member.id)} selected={diy.plan.undercutter.memberId} labels={(id) => diy.plan.team.find((member) => member.id === id)?.name || t('select')} onChange={(memberId) => update((plan) => updateDiyPlan(plan, { undercutter: { ...plan.undercutter, memberId } }))} />
              <BooleanRow label={t('team.undercutterAgrees')} value={diy.plan.undercutter.agreesToSolutionAndLeaveTime} onChange={(value) => update((plan) => updateDiyPlan(plan, { undercutter: { ...plan.undercutter, agreesToSolutionAndLeaveTime: value } }))} />
              {diy.plan.undercutter.agreesToSolutionAndLeaveTime === false && <Text style={[styles.note, { color: colors.coral }]}>{t('team.undercutterBlocked')}</Text>}
            </>}
          </StageCard>

          <StageCard title={t('stages.unity')} ready={progress.stages.unity.ready} locked={!access.unity}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('unity.body')}</Text>
            <Text style={[styles.solution, { color: colors.primary }]}>{t('unity.summary', { level: diy.plan.care.indicatedLevel ? t(`care.labels.${diy.plan.care.indicatedLevel}` as never) : '—', program: tapSnapshot.programName, date: diy.plan.interventionDate, leave: tapSnapshot.departureAt ? new Date(tapSnapshot.departureAt).toLocaleString() : '—' })}</Text>
            <CheckRow label={t('unity.solutionConfirmed')} checked={diy.plan.unity.solutionConfirmed} onChange={(solutionConfirmed) => update((plan) => updateDiyPlan(plan, { unity: { ...plan.unity, solutionConfirmed, solutionKey: solutionConfirmed ? solutionKey : '' } }))} />
            <Input label={t('unity.yesPlan')} value={diy.plan.unity.yesPlan} placeholder={t('unity.yesPlaceholder')} onChange={(yesPlan) => update((plan) => updateDiyPlan(plan, { unity: { ...plan.unity, yesPlan } }))} multiline />
            <Input label={t('unity.plannedNo')} value={diy.plan.unity.plannedNo} onChange={(plannedNo) => update((plan) => updateDiyPlan(plan, { unity: { ...plan.unity, plannedNo } }))} multiline />
            <Input label={t('unity.plannedNoStart')} value={diy.plan.unity.plannedNoStartDate} onChange={(plannedNoStartDate) => update((plan) => updateDiyPlan(plan, { unity: { ...plan.unity, plannedNoStartDate } }))} />
            <Input label={t('unity.nextConversation')} value={diy.plan.unity.nextConversationDate} onChange={(nextConversationDate) => update((plan) => updateDiyPlan(plan, { unity: { ...plan.unity, nextConversationDate } }))} />
            <Text style={[styles.note, { color: colors.inkSoft }]}>{t('unity.noDebate')}</Text>
          </StageCard>

          <StageCard title={t('stages.letters')} ready={progress.stages.letters.ready} locked={!access.letters}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('letters.body')}</Text>
            <Text style={[styles.note, { color: colors.coral }]}>{t('letters.rules')}</Text>
            {diy.plan.team.filter((member) => member.role === 'speaker').map((speaker) => {
              const letter = diy.plan.letters[speaker.id] ?? blankDiyLetter();
              return <View key={speaker.id} style={[styles.subcard, { borderColor: colors.line }]}>
                <Text style={[styles.stageTitle, { color: colors.ink }]}>{speaker.name}</Text>
                {(['love', 'facts', 'request', 'boundary'] as const).map((key) => <Input key={key} label={t(`letters.${key}` as never)} value={letter[key]} limit={DIY_LETTER_SECTION_LIMIT} multiline onChange={(value) => update((plan) => updateDiyLetter(plan, speaker.id, { [key]: value }))} />)}
                <CheckRow label={t('letters.complete')} checked={letter.complete} onChange={(complete) => update((plan) => updateDiyLetter(plan, speaker.id, { complete, solutionKey: complete ? solutionKey : '' }))} />
              </View>;
            })}
          </StageCard>

          <StageCard title={t('stages.rehearsal')} ready={progress.stages.rehearsal.ready} locked={!access.rehearsal}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('rehearsal.body')}</Text>
            <Label text={t('rehearsal.facilitator')} /><MemberChoices label={t('rehearsal.facilitator')} plan={diy.plan} selected={diy.plan.rehearsal.facilitatorId} onChange={(facilitatorId) => update((plan) => updateDiyPlan(plan, { rehearsal: { ...plan.rehearsal, facilitatorId } }))} />
            <Label text={t('rehearsal.debateHolder')} /><MemberChoices label={t('rehearsal.debateHolder')} plan={diy.plan} selected={diy.plan.rehearsal.debateHolderId} onChange={(debateHolderId) => update((plan) => updateDiyPlan(plan, { rehearsal: { ...plan.rehearsal, debateHolderId } }))} />
            <Label text={t('rehearsal.speakerOrder')} />
            {diy.plan.team.filter((member) => member.role === 'speaker').map((speaker) => {
              const index = diy.plan.rehearsal.speakerOrder.indexOf(speaker.id);
              return <TouchableOpacity key={speaker.id} accessibilityRole="checkbox" accessibilityState={{ checked: index >= 0 }} style={[styles.orderRow, { borderColor: colors.line }]} onPress={() => update((plan) => {
                const current = plan.rehearsal.speakerOrder;
                const speakerOrder = current.includes(speaker.id) ? current.filter((id) => id !== speaker.id) : [...current, speaker.id];
                return updateDiyPlan(plan, { rehearsal: { ...plan.rehearsal, speakerOrder } });
              })}><Text style={{ color: colors.ink }}>{index >= 0 ? `${index + 1}. ` : ''}{speaker.name}</Text></TouchableOpacity>;
            })}
            <Input label={t('rehearsal.duration')} value={diy.plan.rehearsal.durationMinutes?.toString() ?? ''} keyboardType="number-pad" onChange={(value) => update((plan) => updateDiyPlan(plan, { rehearsal: { ...plan.rehearsal, durationMinutes: value ? Number(value) : null } }))} />
            {(['makeAskOnce', 'stopDebate', 'noStacking', 'professionalStagingRequested', 'complete'] as const).map((key) => <CheckRow key={key} label={t(key === 'professionalStagingRequested' ? 'rehearsal.needsStaging' : `rehearsal.${key}` as never)} checked={diy.plan.rehearsal[key]} onChange={(value) => update((plan) => updateDiyPlan(plan, { rehearsal: { ...plan.rehearsal, [key]: value, ...(key === 'complete' ? { solutionKey: value ? solutionKey : '' } : {}) } }))} />)}
            {diy.plan.rehearsal.professionalStagingRequested && <OffRamp title={t('professionalButton')} body={t('rehearsal.needsStagingNote')} />}
          </StageCard>

          <StageCard title={t('stages.execute')} ready={progress.stages.execute.ready} locked={!access.execute}>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('execute.body')}</Text>
            <Text style={[styles.stageTitle, { color: colors.ink }]}>{t('execute.amaTitle')}</Text>
            {(['written', 'familyIsNotRide', 'houseDoesNotOpen', 'moneyDoesNotMove', 'callFacilityFirst', 'useTapBackup'] as const).map((key) => {
              const labelKey = { written: 'amaWritten', familyIsNotRide: 'familyNotRide', houseDoesNotOpen: 'houseClosed', moneyDoesNotMove: 'moneyHeld', callFacilityFirst: 'callFacility', useTapBackup: 'tapBackup' }[key];
              return <CheckRow key={key} label={t(`execute.${labelKey}` as never)} checked={diy.plan.ama[key]} onChange={(value) => update((plan) => updateDiyPlan(plan, { ama: { ...plan.ama, [key]: value, ...(key === 'written' ? { solutionKey: value ? solutionKey : '' } : {}) } }))} />;
            })}
            <Input label={t('execute.amaNote')} value={diy.plan.ama.note} multiline onChange={(note) => update((plan) => updateDiyPlan(plan, { ama: { ...plan.ama, note } }))} />
            <Text style={[styles.stageTitle, { color: colors.ink }]}>{t('execute.dayTitle')}</Text>
            <Text style={[styles.note, { color: colors.inkSoft }]}>{t('execute.dayLocked')}</Text>
            {(['bedReconfirmedMorning', 'teamArrived', 'phonesHandled', 'lettersInOrder', 'askMadeOnce'] as const).map((key) => {
              const labelKey = { bedReconfirmedMorning: 'bedMorning', teamArrived: 'teamArrived', phonesHandled: 'phonesHandled', lettersInOrder: 'lettersOrder', askMadeOnce: 'askOnce' }[key];
              return <CheckRow key={key} label={t(`execute.${labelKey}` as never)} checked={diy.plan.dayOf[key]} onChange={(value) => update((plan) => updateDiyPlan(plan, { dayOf: { ...plan.dayOf, [key]: value } }))} />;
            })}
            <Label text={t('execute.outcome')} /><ChoiceRow groupLabel={t('execute.outcome')} values={['yes_left_for_program', 'planned_no_started'] as const} selected={diy.plan.dayOf.outcome} labels={(value) => t(value === 'yes_left_for_program' ? 'execute.yesOutcome' : 'execute.noOutcome')} onChange={(outcome) => update((plan) => updateDiyPlan(plan, { dayOf: { ...plan.dayOf, outcome, completedAt: new Date().toISOString() } }))} />
          </StageCard>

          {diy.saveState === 'error' ? <View accessibilityRole="alert"><Text style={[styles.note, { color: colors.coral }]}>{t('saveError')}</Text><TextButton label={t('retry')} onPress={diy.retrySave} /></View> : <Text accessibilityLiveRegion="polite" style={[styles.note, { color: colors.inkSoft }]}>{diy.saveState === 'saving' ? t('saving') : t('saved')}</Text>}
          <TextButton label={t('clear')} onPress={confirmClear} danger />
        </>
      )}
    </ScreenContainer>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <ScreenContainer contentContainerStyle={styles.wrap}>{children}</ScreenContainer>;
}
function SafetyPanel() {
  const router = useRouter(); const { colors } = useTheme(); const { t } = useTranslation('diyInterventionPlanner');
  return <View accessibilityRole="alert" style={[styles.safety, { borderColor: colors.coral }]}>
    <Text style={[styles.stageTitle, { color: colors.coral }]}>{t('safetyTitle')}</Text>
    <Text style={[styles.body, { color: colors.ink }]}>{t('safetyBody')}</Text>
    <PrimaryButton label={t('helpNow')} onPress={() => router.push('/treatment-action-plan' as never)} />
    <View style={styles.safetyActions}>
      <TextButton label={t('call911')} onPress={() => void Linking.openURL('tel:911')} danger />
      <TextButton label={t('call988')} onPress={() => void Linking.openURL('tel:988')} danger />
    </View>
  </View>;
}
function StageCard({ title, ready, locked, children }: { title: string; ready: boolean; locked: boolean; children: React.ReactNode }) {
  const { colors } = useTheme(); const { t } = useTranslation('diyInterventionPlanner');
  return <View style={[styles.card, { borderColor: ready ? colors.green : locked ? colors.line : colors.primary, backgroundColor: colors.white }]}><View style={styles.titleRow}><Text style={[styles.stageTitle, { color: colors.ink }]}>{title}</Text><Text style={{ color: ready ? colors.green : colors.inkSoft }}>{ready ? '✓' : locked ? '🔒' : '○'}</Text></View>{locked ? <Text style={[styles.body, { color: colors.inkSoft }]}>{t('locked')}</Text> : children}</View>;
}
function OffRamp({ title, body }: { title: string; body: string }) {
  const router = useRouter(); const { colors } = useTheme(); const { t } = useTranslation('diyInterventionPlanner');
  return <View accessibilityRole="alert" style={[styles.alert, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}><Text style={[styles.stageTitle, { color: colors.coral }]}>{title}</Text><Text style={[styles.body, { color: colors.ink }]}>{body}</Text><Text style={[styles.note, { color: colors.inkSoft }]}>{t('professionalNote')}</Text><PrimaryButton label={t('professionalButton')} onPress={() => router.push('/(tabs)/support' as never)} /></View>;
}
function Label({ text }: { text: string }) { const { colors } = useTheme(); return <Text style={[styles.label, { color: colors.ink }]}>{text}</Text>; }
function Input({ label, value, onChange, multiline = false, limit = DIY_TEXT_LIMIT, placeholder, keyboardType = 'default' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; limit?: number; placeholder?: string; keyboardType?: 'default' | 'number-pad' }) {
  const { colors } = useTheme(); return <View><Label text={label} /><TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline, { color: colors.ink, borderColor: colors.line }]} value={value} onChangeText={onChange} multiline={multiline} maxLength={limit} placeholder={placeholder} placeholderTextColor={colors.inkSoft} keyboardType={keyboardType} /></View>;
}
function ChoiceRow<T extends string>({ groupLabel, values, selected, labels, onChange }: { groupLabel: string; values: readonly T[]; selected: string; labels: (value: T) => string; onChange: (value: T) => void }) {
  const { colors } = useTheme(); return <View accessibilityRole="radiogroup" accessibilityLabel={groupLabel} style={styles.chips}>{values.map((value) => { const label = labels(value); const active = selected === value; return <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={`${groupLabel} — ${label}`} style={[styles.chip, { borderColor: active ? colors.primary : colors.line, backgroundColor: active ? colors.primaryLight : colors.white }]} onPress={() => onChange(value)}><Text style={{ color: active ? colors.primary : colors.ink }}>{label}</Text></TouchableOpacity>; })}</View>;
}
function YesNoRow({ label, value, onChange }: { label: string; value: DiyAnswer; onChange: (value: DiyAnswer) => void }) { const { t } = useTranslation('diyInterventionPlanner'); return <View><Label text={label} /><ChoiceRow groupLabel={label} values={['yes', 'no'] as const} selected={value} labels={(choice) => t(choice)} onChange={onChange} /></View>; }
function BooleanRow({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) { const { t } = useTranslation('diyInterventionPlanner'); return <View><Label text={label} /><ChoiceRow groupLabel={label} values={['yes', 'no'] as const} selected={value === null ? '' : value ? 'yes' : 'no'} labels={(choice) => t(choice)} onChange={(choice) => onChange(choice === 'yes')} /></View>; }
function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { const { colors } = useTheme(); return <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} style={styles.checkRow} onPress={() => onChange(!checked)}><View style={[styles.checkbox, { backgroundColor: checked ? colors.green : colors.white, borderColor: checked ? colors.green : colors.line }]}><Text style={{ color: colors.white }}>{checked ? '✓' : ''}</Text></View><Text style={[styles.checkLabel, { color: colors.ink }]}>{label}</Text></TouchableOpacity>; }
function MemberChoices({ label, plan, selected, onChange }: { label: string; plan: DiyInterventionPlan; selected: string; onChange: (id: string) => void }) { const eligible = plan.team.filter((member) => member.aligned === true && (member.role === 'speaker' || member.role === 'silent_support')); return <ChoiceRow groupLabel={label} values={eligible.map((member) => member.id)} selected={selected} labels={(id) => eligible.find((member) => member.id === id)?.name || '—'} onChange={onChange} />; }
function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) { const { colors } = useTheme(); return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={onPress}><Text style={styles.primaryText}>{label}</Text></TouchableOpacity>; }
function TextButton({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) { const { colors } = useTheme(); return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={styles.textButton} onPress={onPress}><Text style={{ color: danger ? colors.coral : colors.primary, fontWeight: '800' }}>{label}</Text></TouchableOpacity>; }

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 50, gap: 14 }, back: { fontSize: 14, fontWeight: '800' },
  hero: { borderRadius: 20, padding: 20, gap: 8 }, kicker: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }, title: { color: '#fff', fontSize: 27, fontWeight: '900' }, intro: { color: '#fff', fontSize: 14, lineHeight: 21 }, privacy: { color: '#fff', fontSize: 12, fontWeight: '800' },
  safety: { borderWidth: 1.5, borderRadius: 15, padding: 15, gap: 6 }, safetyActions: { flexDirection: 'row', justifyContent: 'space-around', gap: 12 }, readiness: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 7 }, progress: { fontWeight: '900' },
  card: { borderWidth: 1.5, borderRadius: 17, padding: 16, gap: 12 }, subcard: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 10 }, alert: { borderWidth: 1.5, borderRadius: 13, padding: 13, gap: 8 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, stageTitle: { fontSize: 17, fontWeight: '900', flexShrink: 1 }, body: { fontSize: 13.5, lineHeight: 20 }, education: { fontSize: 12.5, lineHeight: 18 }, note: { fontSize: 12.5, lineHeight: 18 }, label: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 6 }, multiline: { minHeight: 88, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 }, chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }, checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, checkLabel: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  summaryLine: { fontSize: 13, lineHeight: 19 }, solution: { fontSize: 14, lineHeight: 20, fontWeight: '900' }, orderRow: { borderWidth: 1, borderRadius: 9, padding: 11 },
  primaryButton: { borderRadius: 11, paddingVertical: 13, paddingHorizontal: 14, alignItems: 'center', marginTop: 4 }, primaryText: { color: '#fff', fontWeight: '900' }, textButton: { paddingVertical: 10, alignItems: 'center' },
});
