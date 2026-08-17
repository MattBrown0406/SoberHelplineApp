import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { EmergencyActions } from '../src/components/safety/EmergencyActions';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useSafetyWallet } from '../src/hooks/useSafetyWallet';
import {
  isSafetyWalletReady,
  safetyWalletCoreProgress,
  type SafetyIncident,
  type SafetyPlan,
} from '../src/lib/safetyWallet';

type PlanField = keyof SafetyPlan;
type IncidentDraft = Omit<SafetyIncident, 'id' | 'createdAt'>;

const FIELD_GROUPS: Array<{ key: string; fields: PlanField[] }> = [
  {
    key: 'household',
    fields: ['lovedOneName', 'householdAddress', 'emergencyContacts', 'preferredHospital'],
  },
  {
    key: 'overdose',
    fields: ['substances', 'overdoseHistory', 'naloxoneLocation', 'naloxoneExpiresOn'],
  },
  {
    key: 'dependents',
    fields: ['childrenInHome', 'safeAdult', 'childPickupPlan', 'keysAndMedicationPlan', 'weaponsAccess'],
  },
  {
    key: 'family',
    fields: ['suicideHistory', 'insurance', 'currentBoundaries', 'decisionMakers'],
  },
];

const MULTILINE_FIELDS = new Set<PlanField>([
  'emergencyContacts',
  'childPickupPlan',
  'keysAndMedicationPlan',
  'currentBoundaries',
]);

const EMPTY_INCIDENT: IncidentDraft = {
  summary: '',
  substances: '',
  threats: '',
  childrenPresent: false,
  policeOrEms: false,
  boundaryCrossed: false,
};

export default function SafetyWalletScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('crisis');
  const { user } = useAccount();
  const { lovedOne } = useLovedOne(user?.id ?? null);
  const { plan, setPlan, incidents, addIncident, hydrated, clear } = useSafetyWallet(user?.id ?? null);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState<IncidentDraft>(EMPTY_INCIDENT);

  useEffect(() => {
    if (!hydrated || !lovedOne) return;
    setPlan((current) => ({
      ...current,
      lovedOneName: current.lovedOneName || lovedOne.first_name || '',
      substances: current.substances || lovedOne.substances.join(', '),
    }));
  }, [hydrated, lovedOne, setPlan]);

  const completedFields = useMemo(
    () => Object.values(plan).filter((value) => value.trim().length > 0).length,
    [plan],
  );
  const coreProgress = useMemo(() => safetyWalletCoreProgress(plan), [plan]);
  const walletReady = isSafetyWalletReady(plan);

  function updatePlan(key: PlanField, value: string) {
    setPlan((current) => ({ ...current, [key]: value }));
  }

  function saveIncident() {
    if (!incidentDraft.summary.trim()) {
      Alert.alert(t('incident.alertTitle'), t('incident.alertBody'));
      return;
    }
    addIncident({
      ...incidentDraft,
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      summary: incidentDraft.summary.trim(),
    });
    setIncidentDraft(EMPTY_INCIDENT);
    setShowIncidentForm(false);
  }

  async function shareWallet() {
    const details = FIELD_GROUPS.flatMap((group) => [
      '',
      t(`wallet.groups.${group.key}` as never).toUpperCase(),
      ...group.fields.flatMap((key) => {
        const value = plan[key].trim();
        return value ? [`${t(`wallet.fields.${key}` as never)}: ${value}`] : [];
      }),
    ]);
    const recent = incidents.slice(0, 5).map((incident) =>
      `• ${new Date(incident.createdAt).toLocaleString()}: ${incident.summary}`,
    );
    await Share.share({
      title: t('wallet.shareTitle'),
      message: [
        t('wallet.shareHeading'),
        ...details,
        ...(recent.length ? ['', t('wallet.recentIncidents').toUpperCase(), ...recent] : []),
        '',
        t('wallet.shareNote'),
      ].join('\n'),
    });
  }

  function confirmClear() {
    Alert.alert(t('wallet.clearTitle'), t('wallet.clearBody'), [
      { text: t('wallet.cancel'), style: 'cancel' },
      { text: t('wallet.clearConfirm'), style: 'destructive', onPress: () => void clear() },
    ]);
  }

  function finishWallet() {
    Keyboard.dismiss();
    router.back();
  }

  return (
    <ScreenContainer keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>

      <View style={[styles.hero, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroIcon}>🛟</Text>
          <View style={styles.flexOne}>
            <Text style={[styles.kicker, { color: colors.coral }]}>{t('wallet.kicker')}</Text>
            <Text style={[styles.title, { color: colors.ink }]}>{t('wallet.title')}</Text>
          </View>
        </View>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('wallet.body')}</Text>
        <View style={[styles.offlineBadge, { backgroundColor: colors.greenLight }]}>
          <Text style={[styles.offlineText, { color: colors.green }]}>{t('wallet.offline')}</Text>
        </View>
      </View>

      <EmergencyActions prominent />

      <TouchableOpacity
        style={[styles.crisisButton, { backgroundColor: colors.coral }]}
        onPress={() => router.push('/crisis-mode')}
        accessibilityRole="button"
      >
        <Text style={styles.crisisButtonText}>{t('wallet.startGuide')}</Text>
      </TouchableOpacity>

      {!hydrated ? (
        <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('wallet.loading')}</Text>
        </View>
      ) : (
        <>
          <View style={[styles.statusCard, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.statusTitle, { color: colors.ink }]}>
              {t('wallet.savedCount', { count: completedFields })}
            </Text>
            <Text style={[styles.small, { color: colors.inkSoft }]}>{t('wallet.autoSave')}</Text>
            <Text style={[styles.coreProgress, { color: colors.primary }]}>
              {t('wallet.coreProgress', coreProgress)}
            </Text>
          </View>

          {FIELD_GROUPS.map((group) => (
            <View key={group.key} style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.sectionTitle, { color: colors.ink }]}>
                {t(`wallet.groups.${group.key}` as never)}
              </Text>
              <Text style={[styles.small, { color: colors.inkSoft }]}>
                {t(`wallet.groupHelp.${group.key}` as never)}
              </Text>
              {group.fields.map((key) => (
                <WalletField
                  key={key}
                  label={t(`wallet.fields.${key}` as never)}
                  value={plan[key]}
                  placeholder={t(`wallet.placeholders.${key}` as never)}
                  multiline={MULTILINE_FIELDS.has(key)}
                  onChangeText={(value) => updatePlan(key, value)}
                  colors={colors}
                />
              ))}
            </View>
          ))}

          {walletReady && (
            <View
              accessibilityRole="summary"
              style={[styles.readyCard, { backgroundColor: colors.greenLight, borderColor: colors.green }]}
            >
              <Text style={[styles.readyTitle, { color: colors.green }]}>{t('wallet.readyTitle')}</Text>
              <Text style={[styles.small, { color: colors.inkSoft }]}>{t('wallet.readyBody')}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.primaryButton, { backgroundColor: colors.green }]}
                onPress={finishWallet}
                activeOpacity={0.82}
              >
                <Text style={styles.primaryButtonText}>{t('wallet.finish')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('wallet.recentIncidents')}</Text>
            <Text style={[styles.small, { color: colors.inkSoft }]}>{t('wallet.incidentHelp')}</Text>
            {incidents.slice(0, 5).map((incident) => (
              <View key={incident.id} style={[styles.incident, { borderTopColor: colors.line }]}>
                <Text style={[styles.incidentDate, { color: colors.inkSoft }]}>
                  {new Date(incident.createdAt).toLocaleString()}
                </Text>
                <Text style={[styles.body, { color: colors.ink }]}>{incident.summary}</Text>
              </View>
            ))}
            {!incidents.length && <Text style={[styles.empty, { color: colors.inkSoft }]}>{t('wallet.noIncidents')}</Text>}

            {showIncidentForm ? (
              <View style={[styles.incidentForm, { borderTopColor: colors.line }]}>
                <WalletField label={t('incident.what')} value={incidentDraft.summary} placeholder={t('field.placeholder')} multiline onChangeText={(summary) => setIncidentDraft((current) => ({ ...current, summary }))} colors={colors} />
                <WalletField label={t('incident.substances')} value={incidentDraft.substances} placeholder={t('field.placeholder')} onChangeText={(substances) => setIncidentDraft((current) => ({ ...current, substances }))} colors={colors} />
                <WalletField label={t('incident.threats')} value={incidentDraft.threats} placeholder={t('field.placeholder')} multiline onChangeText={(threats) => setIncidentDraft((current) => ({ ...current, threats }))} colors={colors} />
                <IncidentToggle label={t('incident.childrenPresent')} value={incidentDraft.childrenPresent} onPress={() => setIncidentDraft((current) => ({ ...current, childrenPresent: !current.childrenPresent }))} colors={colors} />
                <IncidentToggle label={t('incident.policeOrEms')} value={incidentDraft.policeOrEms} onPress={() => setIncidentDraft((current) => ({ ...current, policeOrEms: !current.policeOrEms }))} colors={colors} />
                <IncidentToggle label={t('incident.boundaryCrossed')} value={incidentDraft.boundaryCrossed} onPress={() => setIncidentDraft((current) => ({ ...current, boundaryCrossed: !current.boundaryCrossed }))} colors={colors} />
                <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={saveIncident}>
                  <Text style={styles.primaryButtonText}>{t('incident.save')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.textButton} onPress={() => setShowIncidentForm(false)}>
                  <Text style={[styles.textButtonLabel, { color: colors.inkSoft }]}>{t('wallet.cancel')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[styles.outlineButton, { borderColor: colors.primary }]} onPress={() => setShowIncidentForm(true)}>
                <Text style={[styles.outlineButtonText, { color: colors.primary }]}>{t('wallet.addIncident')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => void shareWallet()}>
            <Text style={styles.primaryButtonText}>{t('wallet.share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={confirmClear}>
            <Text style={[styles.textButtonLabel, { color: colors.coral }]}>{t('wallet.clear')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScreenContainer>
  );
}

function WalletField({
  label,
  value,
  placeholder,
  onChangeText,
  colors,
  multiline = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  colors: ReturnType<typeof useTheme>['colors'];
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        multiline={multiline}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: colors.ink, borderColor: colors.line, backgroundColor: colors.white },
        ]}
      />
    </View>
  );
}

function IncidentToggle({
  label,
  value,
  onPress,
  colors,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <TouchableOpacity
      style={styles.toggleRow}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.toggleBox, { borderColor: value ? colors.primary : colors.line, backgroundColor: value ? colors.primary : colors.white }]}>
        <Text style={styles.toggleMark}>{value ? '✓' : ''}</Text>
      </View>
      <Text style={[styles.toggleLabel, { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  flexOne: { flex: 1 },
  back: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  hero: { borderWidth: 1, borderRadius: 24, padding: 20, marginBottom: 14 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  heroIcon: { fontSize: 30 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 3 },
  title: { fontSize: 28, lineHeight: 33, fontWeight: '900' },
  body: { fontSize: 14.5, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 19 },
  offlineBadge: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, marginTop: 12 },
  offlineText: { fontSize: 12, fontWeight: '800' },
  crisisButton: { borderRadius: 15, padding: 15, alignItems: 'center', marginBottom: 14 },
  crisisButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  loading: { padding: 28, alignItems: 'center', gap: 10 },
  statusCard: { borderRadius: 16, padding: 15, marginBottom: 14 },
  statusTitle: { fontSize: 15, fontWeight: '900', marginBottom: 3 },
  coreProgress: { fontSize: 12.5, fontWeight: '800', marginTop: 8 },
  readyCard: { borderWidth: 1.5, borderRadius: 20, padding: 18, marginBottom: 14 },
  readyTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900', marginBottom: 5 },
  card: { borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 14 },
  sectionTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900', marginBottom: 4 },
  fieldWrap: { marginTop: 13 },
  fieldLabel: { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  incident: { borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  incidentDate: { fontSize: 11, marginBottom: 3 },
  empty: { fontSize: 13, fontStyle: 'italic', marginTop: 14 },
  incidentForm: { borderTopWidth: 1, marginTop: 16, paddingTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  toggleBox: { width: 24, height: 24, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  toggleMark: { color: '#fff', fontWeight: '900' },
  toggleLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  primaryButton: { borderRadius: 15, padding: 14, alignItems: 'center', marginTop: 10 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  outlineButton: { borderWidth: 1.5, borderRadius: 14, padding: 13, alignItems: 'center', marginTop: 16 },
  outlineButtonText: { fontSize: 14, fontWeight: '900' },
  textButton: { padding: 14, alignItems: 'center' },
  textButtonLabel: { fontSize: 14, fontWeight: '800' },
});
