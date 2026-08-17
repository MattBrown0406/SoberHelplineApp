import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useFamilyOutcomes } from '../src/hooks/useFamilyOutcomes';
import {
  defaultFamilyOutcomeDraft,
  FAMILY_OUTCOME_EVENTS,
  FAMILY_OUTCOME_LEVELS,
  FAMILY_OUTCOME_PATHWAYS,
  isFamilyOutcomeEvent,
  isFamilyOutcomePathway,
  validateFamilyOutcomeDraft,
  type FamilyOutcome,
  type FamilyOutcomeDraft,
} from '../src/lib/familyOutcomes';

export default function FamilyOutcomesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ event?: string; pathway?: string }>();
  const { t } = useTranslation('familyOutcomes');
  const { colors } = useTheme();
  const { user } = useAccount();
  const controller = useFamilyOutcomes(user?.id ?? null);
  const initialDraft = useMemo(() => defaultFamilyOutcomeDraft(
    isFamilyOutcomeEvent(params.event) ? params.event : 'entered_care',
    isFamilyOutcomePathway(params.pathway) ? params.pathway : 'unknown',
  ), [params.event, params.pathway]);
  const [draft, setDraft] = useState<FamilyOutcomeDraft>(initialDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [validationKey, setValidationKey] = useState<string | null>(null);

  const reset = () => {
    setDraft(defaultFamilyOutcomeDraft());
    setEditingId(null);
    setReviewing(false);
    setValidationKey(null);
  };

  const beginReview = () => {
    const invalid = validateFamilyOutcomeDraft(draft);
    setValidationKey(invalid);
    if (!invalid) setReviewing(true);
  };

  const confirm = async () => {
    const saved = editingId
      ? await controller.update(editingId, draft)
      : await controller.create(draft);
    if (saved) reset();
  };

  const correct = (outcome: FamilyOutcome) => {
    setDraft({
      event: outcome.event,
      occurredOn: outcome.occurredOn,
      levelOfCare: outcome.levelOfCare,
      pathway: outcome.pathway,
      pathwayNote: outcome.pathwayNote ?? '',
    });
    setEditingId(outcome.id);
    setReviewing(false);
    setValidationKey(null);
  };

  const confirmDelete = (outcome: FamilyOutcome) => Alert.alert(
    t('deleteTitle'),
    t('deleteBody'),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: t('deleteConfirm'), style: 'destructive', onPress: () => void controller.remove(outcome.id) },
    ],
  );

  return (
    <ScreenContainer scroll contentContainerStyle={styles.screen}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('backLabel')} onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.kicker, { color: colors.primary }]}>{t('kicker')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <View style={[styles.privacyCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
        <Text style={[styles.privacy, { color: colors.ink }]}>{t('privacy')}</Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>
          {editingId ? t('correctTitle') : t('captureTitle')}
        </Text>
        {reviewing ? (
          <Review draft={draft} />
        ) : (
          <>
            <ChoiceGroup
              label={t('eventLabel')}
              values={FAMILY_OUTCOME_EVENTS}
              value={draft.event}
              translationPrefix="events"
              onChange={(event) => setDraft((current) => ({ ...current, event }))}
            />
            <Text style={[styles.label, { color: colors.ink }]}>{t('dateLabel')}</Text>
            <TextInput
              accessibilityLabel={t('dateLabel')}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              placeholder={t('datePlaceholder')}
              placeholderTextColor={colors.inkSoft}
              value={draft.occurredOn}
              onChangeText={(occurredOn) => setDraft((current) => ({ ...current, occurredOn }))}
              style={[styles.input, { color: colors.ink, backgroundColor: colors.cream, borderColor: colors.line }]}
            />
            <Text style={[styles.help, { color: colors.inkSoft }]}>{t('dateHelp')}</Text>
            <ChoiceGroup
              label={t('levelLabel')}
              values={FAMILY_OUTCOME_LEVELS}
              value={draft.levelOfCare}
              translationPrefix="levels"
              onChange={(levelOfCare) => setDraft((current) => ({ ...current, levelOfCare }))}
            />
            <ChoiceGroup
              label={t('pathwayLabel')}
              values={FAMILY_OUTCOME_PATHWAYS}
              value={draft.pathway}
              translationPrefix="pathways"
              onChange={(pathway) => setDraft((current) => ({ ...current, pathway }))}
            />
            <Text style={[styles.label, { color: colors.ink }]}>{t('noteLabel')}</Text>
            <TextInput
              accessibilityLabel={t('noteLabel')}
              multiline
              maxLength={500}
              value={draft.pathwayNote}
              onChangeText={(pathwayNote) => setDraft((current) => ({ ...current, pathwayNote }))}
              placeholder={t('notePlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={[styles.noteInput, { color: colors.ink, backgroundColor: colors.cream, borderColor: colors.line }]}
            />
            <Text style={[styles.help, { color: colors.inkSoft }]}>{t('noteCount', { count: draft.pathwayNote.length })}</Text>
          </>
        )}

        {validationKey && (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>
            {t(`validation.${validationKey}`)}
          </Text>
        )}
        {controller.operationError && (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('saveError')}</Text>
        )}

        <View style={styles.actions}>
          {reviewing ? (
            <>
              <ActionButton label={editingId ? t('confirmCorrection') : t('confirmSave')} onPress={() => void confirm()} loading={controller.saving} />
              <ActionButton label={t('backToEdit')} secondary onPress={() => setReviewing(false)} />
            </>
          ) : (
            <>
              <ActionButton label={t('review')} onPress={beginReview} />
              {editingId && <ActionButton label={t('cancelCorrection')} secondary onPress={reset} />}
            </>
          )}
        </View>
      </View>

      <Text accessibilityRole="header" style={[styles.timelineTitle, { color: colors.ink }]}>{t('recentTitle')}</Text>
      {controller.loading ? (
        <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.help, { color: colors.inkSoft }]}>{t('loading')}</Text>
        </View>
      ) : controller.loadError ? (
        <View accessibilityRole="alert" style={[styles.stateCard, { borderColor: colors.coral }]}>
          <Text style={[styles.error, { color: colors.coral }]}>{t('loadError')}</Text>
          <ActionButton label={t('retry')} secondary onPress={() => void controller.reload()} />
        </View>
      ) : controller.outcomes.length === 0 ? (
        <Text style={[styles.empty, { color: colors.inkSoft }]}>{t('empty')}</Text>
      ) : (
        controller.outcomes.map((outcome) => (
          <TimelineEntry key={outcome.id} outcome={outcome} onCorrect={() => correct(outcome)} onDelete={() => confirmDelete(outcome)} />
        ))
      )}
    </ScreenContainer>
  );
}

function ChoiceGroup<T extends string>({
  label,
  values,
  value,
  translationPrefix,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  translationPrefix: string;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation('familyOutcomes');
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup">
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={styles.choices}>
        {values.map((option) => {
          const selected = option === value;
          const optionLabel = t(`${translationPrefix}.${option}`);
          return (
            <TouchableOpacity
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${optionLabel}`}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? colors.primary : colors.white,
                  borderColor: selected ? colors.primary : colors.line,
                },
              ]}
            >
              <Text style={[styles.choiceText, { color: selected ? '#fff' : colors.ink }]}>{optionLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Review({ draft }: { draft: FamilyOutcomeDraft }) {
  const { t } = useTranslation('familyOutcomes');
  const { colors } = useTheme();
  const rows = [
    [t('eventLabel'), t(`events.${draft.event}`)],
    [t('dateLabel'), draft.occurredOn],
    [t('levelLabel'), t(`levels.${draft.levelOfCare}`)],
    [t('pathwayLabel'), t(`pathways.${draft.pathway}`)],
    [t('noteLabel'), draft.pathwayNote.trim() || t('noNote')],
  ];
  return (
    <View accessibilityRole="summary" style={[styles.review, { backgroundColor: colors.cream, borderColor: colors.line }]}>
      <Text style={[styles.reviewTitle, { color: colors.ink }]}>{t('reviewTitle')}</Text>
      {rows.map(([label, content]) => (
        <View key={label} style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: colors.inkSoft }]}>{label}</Text>
          <Text style={[styles.reviewValue, { color: colors.ink }]}>{content}</Text>
        </View>
      ))}
      <Text style={[styles.confirmHint, { color: colors.inkSoft }]}>{t('confirmHint')}</Text>
    </View>
  );
}

function TimelineEntry({ outcome, onCorrect, onDelete }: { outcome: FamilyOutcome; onCorrect: () => void; onDelete: () => void }) {
  const { t } = useTranslation('familyOutcomes');
  const { colors } = useTheme();
  return (
    <View style={[styles.timelineCard, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.timelineDate, { color: colors.primary }]}>{outcome.occurredOn}</Text>
      <Text style={[styles.timelineEvent, { color: colors.ink }]}>{t(`events.${outcome.event}`)}</Text>
      <Text style={[styles.timelineMeta, { color: colors.inkSoft }]}>
        {t(`levels.${outcome.levelOfCare}`)} · {t(`pathways.${outcome.pathway}`)}
      </Text>
      {outcome.pathwayNote && <Text style={[styles.timelineNote, { color: colors.ink }]}>{outcome.pathwayNote}</Text>}
      <View style={styles.timelineActions}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('correctEntryLabel', { date: outcome.occurredOn })} onPress={onCorrect}>
          <Text style={[styles.link, { color: colors.primary }]}>{t('correct')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('deleteEntryLabel', { date: outcome.occurredOn })} onPress={onDelete}>
          <Text style={[styles.link, { color: colors.coral }]}>{t('delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ActionButton({ label, onPress, secondary = false, loading = false }: { label: string; onPress: () => void; secondary?: boolean; loading?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={[
        styles.button,
        secondary
          ? { backgroundColor: colors.white, borderColor: colors.primary, borderWidth: 1.5 }
          : { backgroundColor: colors.primary },
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 44 },
  back: { fontSize: 14, fontWeight: '700', marginBottom: 16 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 5 },
  intro: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  privacyCard: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 14 },
  privacy: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 18 },
  sectionTitle: { fontSize: 19, fontWeight: '900', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '800', marginTop: 15, marginBottom: 7 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 9, minHeight: 44, justifyContent: 'center' },
  choiceText: { fontSize: 12, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, fontSize: 14 },
  noteInput: { borderWidth: 1, borderRadius: 10, minHeight: 88, padding: 12, fontSize: 14, textAlignVertical: 'top' },
  help: { fontSize: 11.5, lineHeight: 16, marginTop: 5 },
  error: { fontSize: 12.5, lineHeight: 18, fontWeight: '700', marginTop: 10 },
  actions: { gap: 9, marginTop: 16 },
  button: { minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  review: { borderWidth: 1, borderRadius: 13, padding: 13, marginTop: 10 },
  reviewTitle: { fontSize: 15, fontWeight: '900', marginBottom: 5 },
  reviewRow: { marginTop: 9 },
  reviewLabel: { fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewValue: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 2 },
  confirmHint: { fontSize: 11.5, lineHeight: 17, marginTop: 13 },
  timelineTitle: { fontSize: 19, fontWeight: '900', marginTop: 24, marginBottom: 9 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stateCard: { borderWidth: 1, borderRadius: 13, padding: 13 },
  empty: { fontSize: 13.5, lineHeight: 20 },
  timelineCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  timelineDate: { fontSize: 11.5, fontWeight: '900' },
  timelineEvent: { fontSize: 16, fontWeight: '900', marginTop: 3 },
  timelineMeta: { fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  timelineNote: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  timelineActions: { flexDirection: 'row', gap: 22, marginTop: 12 },
  link: { fontSize: 13, fontWeight: '800' },
});
