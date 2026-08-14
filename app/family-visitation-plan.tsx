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
import { useFamilyVisitationPlan } from '../src/hooks/useFamilyVisitationPlan';
import {
  familyVisitationProgress,
  VISITATION_COMMITMENTS,
  type FamilyVisitationPlan,
  type VisitationCommitmentId,
} from '../src/lib/familyVisitationPlan';

type TextFieldKey = Exclude<keyof FamilyVisitationPlan, 'commitments' | 'updatedAt'>;

export default function FamilyVisitationPlanScreen() {
  const router = useRouter();
  const { t } = useTranslation('familyVisitationPlan');
  const { colors } = useTheme();
  const { user } = useAccount();
  const controller = useFamilyVisitationPlan(user?.id ?? null);
  const { plan, loadState, saveState, update, reload, retrySave, clear } = controller;
  const progress = useMemo(() => familyVisitationProgress(plan), [plan]);
  const savedReady = progress.ready && saveState === 'saved';

  const confirmClear = () => Alert.alert(t('clearTitle'), t('clearBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('clearConfirm'), style: 'destructive', onPress: () => void clear().catch(() => undefined) },
  ]);

  const field = (key: TextFieldKey, multiline = false) => (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: colors.ink }]}>{t(`fields.${key}`)}</Text>
      <TextInput
        accessibilityLabel={t(`fields.${key}`)}
        value={plan[key]}
        onChangeText={(value) => update({ [key]: value })}
        placeholder={t(`fields.${key === 'facility' ? 'facilityPlaceholder'
          : key === 'visitDate' ? 'datePlaceholder'
          : key === 'arrivalTime' ? 'arrivalPlaceholder'
          : key === 'leaveTime' ? 'leavePlaceholder'
          : key === 'attendees' ? 'attendeesPlaceholder'
          : key === 'carePackage' ? 'carePackagePlaceholder'
          : 'parkingLotPlaceholder'}`)}
        placeholderTextColor={colors.inkSoft}
        multiline={multiline}
        maxLength={350}
        style={[
          styles.input,
          multiline && styles.multiline,
          { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white },
        ]}
      />
    </View>
  );

  return (
    <ScreenContainer scroll contentContainerStyle={styles.screen}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('kicker')}</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <Text style={[styles.privacy, { color: colors.primary }]}>{t('privacy')}</Text>

      <View accessibilityRole="alert" style={[styles.messageCard, { backgroundColor: colors.primaryDark }]}> 
        <Text style={styles.messageQuote}>{t('coreMessage')}</Text>
        <Text style={styles.messageBody}>{t('coreSupport')}</Text>
      </View>

      {loadState === 'loading' ? (
        <View style={[styles.stateCard, { borderColor: colors.line, backgroundColor: colors.white }]}> 
          <ActivityIndicator accessibilityRole="progressbar" color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.ink }]}>{t('loading')}</Text>
        </View>
      ) : loadState === 'error' ? (
        <View accessibilityRole="alert" style={[styles.stateCard, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}> 
          <Text style={[styles.stateTitle, { color: colors.coral }]}>{t('loadErrorTitle')}</Text>
          <Text style={[styles.stateBody, { color: colors.ink }]}>{t('loadErrorBody')}</Text>
          <ActionButton label={t('retry')} onPress={() => void reload()} />
          <ActionButton label={t('startOver')} destructive onPress={confirmClear} />
        </View>
      ) : (
        <>
          <View accessibilityRole="summary" style={[styles.progressCard, { borderColor: savedReady ? colors.green : colors.coral, backgroundColor: colors.white }]}> 
            <Text style={[styles.progressKicker, { color: savedReady ? colors.green : colors.coral }]}>{t('progressTitle')}</Text>
            <Text style={[styles.progressTitle, { color: savedReady ? colors.green : colors.coral }]}>{savedReady ? t('readyTitle') : t('notReadyTitle')}</Text>
            <Text style={[styles.progressBody, { color: colors.inkSoft }]}>{savedReady ? t('readyBody') : t('notReadyBody')}</Text>
            <Text style={[styles.count, { color: colors.ink }]}>{t('progressCount', { completed: progress.completed, total: progress.total })}</Text>
            <View style={[styles.track, { backgroundColor: colors.line }]}> 
              <View style={[styles.fill, { width: `${Math.round((progress.completed / progress.total) * 100)}%`, backgroundColor: savedReady ? colors.green : colors.coral }]} />
            </View>
            <Text accessibilityRole={saveState === 'error' ? 'alert' : 'text'} style={[styles.saveText, { color: saveState === 'error' ? colors.coral : colors.inkSoft }]}> 
              {saveState === 'saving' ? t('saveSaving') : saveState === 'error' ? t('saveError') : t('saveSaved')}
            </Text>
            {saveState === 'error' && <ActionButton label={t('retrySave')} onPress={retrySave} />}
          </View>

          <Section title={t('sectionPlan')} hint={t('requiredHint')}>
            {field('facility')}
            {field('visitDate')}
            <View style={styles.timeRow}>
              <View style={styles.timeField}>{field('arrivalTime')}</View>
              <View style={styles.timeField}>{field('leaveTime')}</View>
            </View>
            {field('attendees')}
            {field('carePackage', true)}
            {field('parkingLotExitPlan', true)}
          </Section>

          <Section title={t('sectionCommitments')} hint={t('commitmentHint')}>
            {VISITATION_COMMITMENTS.map((id) => (
              <CommitmentRow
                key={id}
                id={id}
                checked={plan.commitments[id]}
                onPress={() => update({ commitments: { ...plan.commitments, [id]: !plan.commitments[id] } })}
              />
            ))}
          </Section>

          <View style={[styles.facilityCard, { borderColor: colors.secondary, backgroundColor: colors.secondaryLight }]}> 
            <Text style={[styles.facilityText, { color: colors.ink }]}>{t('facilityRule')}</Text>
          </View>
          <Text style={[styles.footer, { color: colors.inkSoft }]}>{t('footer')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('startOver')} onPress={confirmClear} style={styles.clearButton}>
            <Text style={[styles.clearText, { color: colors.coral }]}>{t('startOver')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScreenContainer>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.line, backgroundColor: colors.white }]}> 
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.sectionHint, { color: colors.inkSoft }]}>{hint}</Text>
      {children}
    </View>
  );
}

function CommitmentRow({ id, checked, onPress }: { id: VisitationCommitmentId; checked: boolean; onPress: () => void }) {
  const { t } = useTranslation('familyVisitationPlan');
  const { colors } = useTheme();
  const label = t(`commitments.${id}`);
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.checkRow, { borderColor: checked ? colors.green : colors.line, backgroundColor: checked ? colors.greenLight : colors.white }]}
    >
      <View style={[styles.checkbox, { borderColor: checked ? colors.green : colors.inkSoft, backgroundColor: checked ? colors.green : colors.white }]}> 
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </View>
      <Text style={[styles.checkLabel, { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionButton({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.actionButton, { backgroundColor: destructive ? colors.coral : colors.primary }]}> 
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 48 },
  back: { fontSize: 15, fontWeight: '700', marginBottom: 20 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 7 },
  title: { fontSize: 29, lineHeight: 34, fontWeight: '900', marginBottom: 10 },
  intro: { fontSize: 16, lineHeight: 23, marginBottom: 8 },
  privacy: { fontSize: 12.5, lineHeight: 18, fontWeight: '700', marginBottom: 18 },
  messageCard: { borderRadius: 16, padding: 20, marginBottom: 18 },
  messageQuote: { color: '#fff', fontSize: 19, lineHeight: 26, fontWeight: '900', marginBottom: 10 },
  messageBody: { color: '#d9e3ed', fontSize: 14, lineHeight: 21 },
  stateCard: { borderWidth: 1, borderRadius: 14, padding: 20, gap: 12, marginBottom: 18 },
  stateText: { fontSize: 15, textAlign: 'center' },
  stateTitle: { fontSize: 18, fontWeight: '800' },
  stateBody: { fontSize: 14, lineHeight: 21 },
  progressCard: { borderWidth: 2, borderRadius: 16, padding: 18, marginBottom: 18 },
  progressKicker: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, marginBottom: 6 },
  progressTitle: { fontSize: 21, fontWeight: '900', marginBottom: 5 },
  progressBody: { fontSize: 14, lineHeight: 20, marginBottom: 10 },
  count: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 999 },
  saveText: { fontSize: 12.5, fontWeight: '700', marginTop: 9 },
  section: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 18 },
  sectionTitle: { fontSize: 19, fontWeight: '900', marginBottom: 4 },
  sectionHint: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  fieldWrap: { marginBottom: 14 },
  label: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', marginBottom: 7 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  timeRow: { flexDirection: 'row', gap: 10 },
  timeField: { flex: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 10, gap: 11 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '900' },
  checkLabel: { flex: 1, fontSize: 14.5, lineHeight: 21, fontWeight: '600' },
  facilityCard: { borderWidth: 1, borderRadius: 12, padding: 15, marginBottom: 16 },
  facilityText: { fontSize: 13.5, lineHeight: 20, fontWeight: '700' },
  footer: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginHorizontal: 8 },
  clearButton: { alignSelf: 'center', padding: 14, marginTop: 10 },
  clearText: { fontSize: 14, fontWeight: '800' },
  actionButton: { alignSelf: 'flex-start', borderRadius: 9, paddingHorizontal: 15, paddingVertical: 10, marginTop: 2 },
  actionButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
