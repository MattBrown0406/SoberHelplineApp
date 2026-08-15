import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useTreatmentActionPlan } from '../src/hooks/useTreatmentActionPlan';
import { TheySaidYesMode } from '../src/components/treatment/TheySaidYesMode';
import {
  isTreatmentActionItemComplete,
  TREATMENT_ACTION_DETAIL_LIMIT,
  TREATMENT_ACTION_ITEMS,
  treatmentActionProgress,
  type TreatmentActionItemDefinition,
  type TreatmentActionStatus,
} from '../src/lib/treatmentActionPlan';

const CATEGORIES = ['admission', 'departure', 'coverage'] as const;
const STATUSES: TreatmentActionStatus[] = ['not_started', 'working', 'confirmed'];

export default function TreatmentActionPlanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('treatmentActionPlan');
  const { user } = useAccount();
  const controller = useTreatmentActionPlan(user?.id ?? null);
  const { plan, hydrated, loadState, saveState, updateItem, updatePlacementDetails, retrySave, reload, clear } = controller;
  const progress = useMemo(() => treatmentActionProgress(plan), [plan]);
  const plannedReady = progress.ready && saveState === 'saved';

  function confirmClear() {
    Alert.alert(t('clearTitle'), t('clearBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clearConfirm'), style: 'destructive', onPress: () => void clear().catch(() => undefined) },
    ]);
  }

  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>

      <View style={[styles.hero, { backgroundColor: colors.primaryDark }]}>
        <Text style={styles.kicker}>{t('kicker')}</Text>
        <Text style={styles.title}>{t('title')}</Text>
        <Text style={styles.intro}>{t('intro')}</Text>
        <View style={[styles.privateBadge, { backgroundColor: colors.secondary }]}>
          <Text style={styles.privateText}>{t('privacy')}</Text>
        </View>
      </View>

      {loadState === 'error' ? (
        <>
          <View accessibilityRole="alert" style={[styles.loadError, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
            <Text style={[styles.readinessTitle, { color: colors.coral }]}>{t('loadErrorTitle')}</Text>
            <Text style={[styles.readinessBody, { color: colors.ink }]}>{t('loadErrorBody')}</Text>
            <TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => void reload()}>
              <Text style={styles.primaryButtonText}>{t('retryLoad')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.clearButton} onPress={confirmClear}>
              <Text style={[styles.clearText, { color: colors.coral }]}>{t('startOver')}</Text>
            </TouchableOpacity>
          </View>
          <SafetyExceptions />
        </>
      ) : !hydrated ? (
        <>
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
          </View>
          <SafetyExceptions />
        </>
      ) : (
        <>
          <SafetyExceptions />

          <TheySaidYesMode controller={controller} />

          <View
            accessibilityRole="summary"
            accessibilityLiveRegion="polite"
            style={[
              styles.readiness,
              {
                backgroundColor: plannedReady ? colors.greenLight : colors.coralLight,
                borderColor: plannedReady ? colors.green : colors.coral,
              },
            ]}
          >
            <Text style={[styles.readinessTitle, { color: plannedReady ? colors.green : colors.coral }]}>
              {plannedReady
                ? t('readyTitle')
                : progress.ready && saveState === 'saving'
                  ? t('plannedSavingTitle')
                  : progress.ready && saveState === 'error'
                    ? t('plannedUnsavedTitle')
                    : t('warningTitle')}
            </Text>
            <Text style={[styles.readinessBody, { color: colors.ink }]}>
              {plannedReady
                ? t('readyBody')
                : progress.ready && saveState === 'saving'
                  ? t('plannedSavingBody')
                  : progress.ready && saveState === 'error'
                    ? t('plannedUnsavedBody')
                    : t('warningBody')}
            </Text>
            <View style={[styles.track, { backgroundColor: colors.white }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${progress.percentage}%`,
                    backgroundColor: plannedReady ? colors.green : colors.coral,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.ink }]}>
              {t('progress', progress)}
            </Text>
          </View>

          {CATEGORIES.map((category) => (
            <View key={category}>
              <Text style={[styles.category, { color: colors.inkSoft }]}>
                {t(`categories.${category}` as never).toUpperCase()}
              </Text>
              {TREATMENT_ACTION_ITEMS.filter((item) => item.category === category).map((definition) => (
                <ActionItemCard
                  key={definition.id}
                  definition={definition}
                  item={plan.items[definition.id]}
                  onStatus={(status) => updateItem(definition.id, { status })}
                  onDetails={(details) => updateItem(definition.id, { details })}
                />
              ))}
            </View>
          ))}

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('placementDetails.title')}</Text>
            <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('placementDetails.body')}</Text>
            {(['programName', 'admissionsContactName', 'bedConfirmedFor', 'bedConfirmationWindow', 'bedConfirmedBy'] as const).map((key) => (
              <TextInput
                key={key}
                accessibilityLabel={t(`placementDetails.${key}` as never)}
                style={[styles.input, { color: colors.ink, borderColor: colors.line }]}
                value={plan.placementDetails[key]}
                onChangeText={(value) => updatePlacementDetails({ [key]: value })}
                placeholder={t(`placementDetails.${key}` as never)}
                placeholderTextColor={colors.inkSoft}
                maxLength={TREATMENT_ACTION_DETAIL_LIMIT}
              />
            ))}
            <Text style={[styles.finderNote, { color: colors.inkSoft }]}>
              {t('placementDetails.phoneFromExecution', { phone: plan.execution.admissionsPhone || '—' })}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={() => updatePlacementDetails({ bedReconfirmedAt: new Date().toISOString() })}
            >
              <Text style={styles.primaryButtonText}>
                {plan.placementDetails.bedReconfirmedAt ? t('placementDetails.reconfirmed') : t('placementDetails.reconfirm')}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.finderNote, { color: colors.inkSoft }]}>{t('placementDetails.ownerNote')}</Text>
          </View>

          <View style={[styles.finderCard, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.finderNote, { color: colors.inkSoft }]}>{t('finderNote')}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/finder' as never)}
            >
              <Text style={styles.primaryButtonText}>{t('finderButton')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.finderCard, { backgroundColor: colors.white, borderColor: colors.primary }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('diyPlanner.title')}</Text>
            <Text style={[styles.finderNote, { color: colors.inkSoft }]}>{t('diyPlanner.body')}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/diy-intervention-planner' as never)}
            >
              <Text style={styles.primaryButtonText}>{t('diyPlanner.button')}</Text>
            </TouchableOpacity>
          </View>

          {progress.ready && saveState === 'saved' && (
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: colors.green }]}
              onPress={() => router.push('/plan-intervention' as never)}
            >
              <Text style={styles.primaryButtonText}>{t('interventionButton')}</Text>
            </TouchableOpacity>
          )}

          {saveState === 'error' ? (
            <View accessibilityRole="alert" style={styles.saveErrorRow}>
              <Text style={[styles.saveErrorText, { color: colors.coral }]}>{t('saveError')}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={retrySave}>
                <Text style={[styles.retryText, { color: colors.primary }]}>{t('retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text accessibilityLiveRegion="polite" style={[styles.autoSave, { color: colors.inkSoft }]}>
              {saveState === 'saving' ? t('saving') : t('autoSave')}
            </Text>
          )}
          <TouchableOpacity accessibilityRole="button" style={styles.clearButton} onPress={confirmClear}>
            <Text style={[styles.clearText, { color: colors.coral }]}>{t('clear')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScreenContainer>
  );
}

function SafetyExceptions() {
  const { colors } = useTheme();
  const { t } = useTranslation('treatmentActionPlan');
  return (
    <View accessibilityRole="alert" style={[styles.emergency, { borderColor: colors.coral }]}>
      <Text style={[styles.exceptionsTitle, { color: colors.coral }]}>{t('exceptionsTitle')}</Text>
      <Text style={[styles.emergencyText, { color: colors.ink }]}>{t('spontaneous')}</Text>
      <Text style={[styles.emergencyText, { color: colors.ink }]}>{t('emergency')}</Text>
    </View>
  );
}

function ActionItemCard({
  definition,
  item,
  onStatus,
  onDetails,
}: {
  definition: TreatmentActionItemDefinition;
  item: ReturnType<typeof useTreatmentActionPlan>['plan']['items'][TreatmentActionItemDefinition['id']];
  onStatus: (status: TreatmentActionStatus) => void;
  onDetails: (details: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('treatmentActionPlan');
  const complete = isTreatmentActionItemComplete(definition, item);
  const statusOptions = definition.allowNotApplicable ? [...STATUSES, 'not_applicable' as const] : STATUSES;

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: complete ? colors.green : colors.line }]}>
      <View style={styles.cardTitleRow}>
        <View style={[styles.check, { backgroundColor: complete ? colors.green : colors.primaryLight, borderColor: complete ? colors.green : colors.line }]}>
          <Text style={[styles.checkText, { color: complete ? colors.white : colors.inkSoft }]}>{complete ? '✓' : ''}</Text>
        </View>
        <View style={styles.flexOne}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>
            {t(`items.${definition.id}.title` as never)}
          </Text>
          <Text style={[styles.advanceBadge, { color: colors.coral }]}>{t('advanceBadge')}</Text>
        </View>
      </View>
      <Text style={[styles.cardBody, { color: colors.inkSoft }]}>
        {t(`items.${definition.id}.body` as never)}
      </Text>

      <View style={styles.statusWrap}>
        {statusOptions.map((status) => {
          const selected = item.status === status;
          return (
            <TouchableOpacity
              key={status}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onStatus(status)}
              style={[
                styles.statusChip,
                {
                  borderColor: selected ? colors.primary : colors.line,
                  backgroundColor: selected ? colors.primaryLight : colors.white,
                },
              ]}
            >
              <Text style={[styles.statusText, { color: selected ? colors.primary : colors.inkSoft }]}>
                {t(`status.${status}` as never)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        accessibilityLabel={t(`items.${definition.id}.title` as never)}
        multiline
        maxLength={TREATMENT_ACTION_DETAIL_LIMIT}
        value={item.details}
        onChangeText={onDetails}
        placeholder={t(`items.${definition.id}.placeholder` as never)}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
      />
      {item.status === 'confirmed' && definition.detailsRequired && !item.details.trim() && (
        <Text accessibilityRole="alert" style={[styles.required, { color: colors.coral }]}>
          {t('detailsRequired')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  flexOne: { flex: 1 },
  back: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  hero: { borderRadius: 24, padding: 21, marginBottom: 14 },
  kicker: { color: '#f0bd78', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  title: { color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900' },
  intro: { color: '#e6edf4', fontSize: 15, lineHeight: 22, marginTop: 10 },
  privateBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginTop: 14 },
  privateText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  loading: { paddingVertical: 48 },
  loadError: { borderWidth: 1.5, borderRadius: 18, padding: 17, marginBottom: 12 },
  readiness: { borderWidth: 1.5, borderRadius: 18, padding: 17, marginBottom: 12 },
  readinessTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  readinessBody: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  fill: { height: 10, borderRadius: 5 },
  progressText: { fontSize: 13, fontWeight: '800', marginTop: 7 },
  emergency: { borderLeftWidth: 4, paddingLeft: 12, paddingVertical: 7, marginBottom: 22 },
  exceptionsTitle: { fontSize: 12, fontWeight: '900', marginBottom: 5 },
  emergencyText: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  category: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 9, marginTop: 4 },
  card: { borderWidth: 1.5, borderRadius: 16, padding: 17, marginBottom: 13 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  check: { width: 27, height: 27, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkText: { fontSize: 16, fontWeight: '900' },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  advanceBadge: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8, marginTop: 4 },
  cardBody: { fontSize: 13.5, lineHeight: 20, marginTop: 10 },
  statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13, marginBottom: 11 },
  statusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  statusText: { fontSize: 11.5, fontWeight: '800' },
  input: { minHeight: 78, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, lineHeight: 19, textAlignVertical: 'top' },
  required: { fontSize: 11.5, fontWeight: '700', marginTop: 7 },
  finderCard: { borderWidth: 1, borderRadius: 16, padding: 17, marginTop: 4, marginBottom: 13 },
  finderNote: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  primaryButton: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  autoSave: { fontSize: 11.5, textAlign: 'center', marginTop: 16 },
  saveErrorRow: { alignItems: 'center', gap: 7, marginTop: 16 },
  saveErrorText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  retryText: { fontSize: 13, fontWeight: '900' },
  clearButton: { alignItems: 'center', paddingVertical: 16 },
  clearText: { fontSize: 13, fontWeight: '800' },
});
