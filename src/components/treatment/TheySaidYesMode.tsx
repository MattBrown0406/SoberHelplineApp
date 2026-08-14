import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { useTreatmentActionPlan } from '../../hooks/useTreatmentActionPlan';
import {
  admissionsDialNumber,
  leaveTonightProgress,
  treatmentYesState,
  TREATMENT_ACTION_EXECUTION_LIMIT,
  TREATMENT_ACTION_SENTENCE_LIMIT,
} from '../../lib/treatmentActionPlan';

type Controller = ReturnType<typeof useTreatmentActionPlan>;

export function TheySaidYesMode({ controller }: { controller: Controller }) {
  const { colors } = useTheme();
  const { t } = useTranslation('treatmentActionPlan');
  const { plan, updateExecution, saveState } = controller;
  const [clock, setClock] = useState(() => new Date());
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const state = treatmentYesState(plan, clock);
  const leaveProgress = useMemo(() => leaveTonightProgress(plan, clock), [plan, clock]);
  const execution = plan.execution;
  const dialNumber = admissionsDialNumber(execution.admissionsPhone);
  const departure = execution.departureAt ? new Date(execution.departureAt) : null;
  const departureLocked = state.mode !== 'idle' && !!departure && Number.isFinite(departure.getTime());
  const pickerValue = departure && Number.isFinite(departure.getTime())
    ? departure
    : new Date(clock.getTime() + 2 * 60 * 60 * 1000);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function changeDeparture(mode: 'date' | 'time') {
    return (_event: DateTimePickerEvent, picked?: Date) => {
      if (Platform.OS !== 'ios') mode === 'date' ? setShowDate(false) : setShowTime(false);
      if (!picked) return;
      const current = pickerValue;
      const next = mode === 'date'
        ? new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), current.getHours(), current.getMinutes())
        : new Date(current.getFullYear(), current.getMonth(), current.getDate(), picked.getHours(), picked.getMinutes());
      updateExecution({ departureAt: next.toISOString() });
    };
  }

  function logYes() {
    const now = new Date();
    updateExecution({
      yesLoggedAt: now.toISOString(),
      recantedAt: null,
      ...(departure && departure.getTime() <= now.getTime() ? { departureAt: null } : {}),
    });
  }

  function confirmRecant() {
    Alert.alert(t('yesMode.recantTitle'), t('yesMode.recantConfirmBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('yesMode.recantConfirm'),
        style: 'destructive',
        onPress: () => updateExecution({ recantedAt: new Date().toISOString() }),
      },
    ]);
  }

  function callAdmissions() {
    if (!dialNumber) return;
    void Linking.openURL(`tel:${dialNumber}`).catch(() => {
      Alert.alert(t('yesMode.callErrorTitle'), t('yesMode.callErrorBody'));
    });
  }

  const elapsedHours = Math.floor(state.elapsedMinutes / 60);
  const elapsedMinutes = state.elapsedMinutes % 60;
  const remaining = state.minutesToDeparture;
  const remainingHours = remaining !== null && remaining > 0 ? Math.floor(remaining / 60) : 0;
  const remainingMinutes = remaining !== null && remaining > 0 ? remaining % 60 : 0;

  return (
    <View style={[styles.card, {
      backgroundColor: state.mode === 'active' ? colors.secondaryLight : colors.white,
      borderColor: state.mode === 'active' ? colors.secondary : state.mode === 'recanted' ? colors.coral : colors.line,
    }]}>
      <Text style={[styles.kicker, { color: state.mode === 'active' ? colors.coral : colors.primary }]}>
        {t('yesMode.kicker')}
      </Text>
      <Text style={[styles.title, { color: colors.ink }]}>
        {state.mode === 'active'
          ? t('yesMode.activeTitle')
          : state.mode === 'recanted'
            ? t('yesMode.recantedTitle')
            : t('yesMode.idleTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>
        {state.mode === 'active'
          ? t('yesMode.activeBody')
          : state.mode === 'recanted'
            ? t('yesMode.recantedBody')
            : t('yesMode.idleBody')}
      </Text>

      {state.mode !== 'idle' && (
        <View accessibilityLiveRegion="polite" style={styles.clockRow}>
          <View style={[styles.clockBox, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.clockLabel, { color: colors.inkSoft }]}>{t('yesMode.sinceYes')}</Text>
            <Text style={[styles.clockValue, { color: colors.coral }]}>
              {t('yesMode.elapsed', { hours: elapsedHours, minutes: elapsedMinutes })}
            </Text>
          </View>
          <View style={[styles.clockBox, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.clockLabel, { color: colors.inkSoft }]}>{t('yesMode.untilLeave')}</Text>
            <Text style={[styles.clockValue, { color: remaining !== null && remaining > 0 ? colors.primary : colors.coral }]}>
              {remaining === null
                ? t('yesMode.noLeaveTime')
                : remaining > 0
                  ? t('yesMode.departureCountdown', { hours: remainingHours, minutes: remainingMinutes })
                  : t('yesMode.leaveNow')}
            </Text>
          </View>
        </View>
      )}

      {state.mode === 'recanted' && (
        <View accessibilityRole="alert" style={[styles.recantBox, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
          <Text style={[styles.recantTitle, { color: colors.coral }]}>{t('yesMode.doNotRerunTitle')}</Text>
          <Text style={[styles.recantBody, { color: colors.ink }]}>{t('yesMode.doNotRerunBody')}</Text>
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('yesMode.executionTitle')}</Text>
      <Text style={[styles.label, { color: colors.ink }]}>{t('yesMode.admissionsPhone')}</Text>
      <TextInput
        accessibilityLabel={t('yesMode.admissionsPhone')}
        keyboardType="phone-pad"
        maxLength={TREATMENT_ACTION_EXECUTION_LIMIT}
        value={execution.admissionsPhone}
        onChangeText={(admissionsPhone) => updateExecution({ admissionsPhone })}
        placeholder={t('yesMode.admissionsPhonePlaceholder')}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
      />
      <Text style={[styles.inputHelp, { color: execution.admissionsPhone.trim() && !dialNumber ? colors.coral : colors.inkSoft }]}>
        {execution.admissionsPhone.trim() && !dialNumber
          ? t('yesMode.admissionsPhoneInvalid')
          : t('yesMode.admissionsPhoneHelp')}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: !dialNumber }}
        disabled={!dialNumber}
        style={[styles.callButton, { backgroundColor: dialNumber ? colors.green : colors.inkSoft }]}
        onPress={callAdmissions}
      >
        <Text style={styles.primaryText}>{t('yesMode.callAdmissions')}</Text>
      </TouchableOpacity>
      <Text style={[styles.label, { color: colors.ink }]}>{t('yesMode.driver')}</Text>
      <TextInput
        accessibilityLabel={t('yesMode.driver')}
        maxLength={TREATMENT_ACTION_EXECUTION_LIMIT}
        value={execution.driver}
        onChangeText={(driver) => updateExecution({ driver })}
        placeholder={t('yesMode.driverPlaceholder')}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
      />

      <Text style={[styles.label, { color: colors.ink }]}>{t('yesMode.leaveTime')}</Text>
      {departureLocked ? (
        <View style={[styles.lockedDeparture, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <Text style={[styles.lockedTime, { color: colors.primary }]}>
            {departure.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
          <Text style={[styles.lockedHint, { color: colors.inkSoft }]}>{t('yesMode.leaveLocked')}</Text>
        </View>
      ) : (
        <>
          <View style={styles.buttonRow}>
            <SmallButton
              label={departure ? departure.toLocaleDateString() : t('yesMode.setDate')}
              onPress={() => setShowDate(true)}
            />
            <SmallButton
              label={departure ? departure.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : t('yesMode.setTime')}
              onPress={() => setShowTime(true)}
            />
          </View>
          {showDate && <DateTimePicker value={pickerValue} mode="date" minimumDate={new Date()} onChange={changeDeparture('date')} />}
          {showTime && <DateTimePicker value={pickerValue} mode="time" minuteInterval={5} onChange={changeDeparture('time')} />}
        </>
      )}

      <View style={styles.twoColumn}>
        <RoleField label={t('yesMode.nightWatch')} value={execution.nightWatch} onChange={(nightWatch) => updateExecution({ nightWatch })} />
        <RoleField label={t('yesMode.phoneHolder')} value={execution.phoneHolder} onChange={(phoneHolder) => updateExecution({ phoneHolder })} />
        <RoleField label={t('yesMode.bagHolder')} value={execution.bagHolder} onChange={(bagHolder) => updateExecution({ bagHolder })} />
      </View>

      <Text style={[styles.label, { color: colors.ink }]}>{t('yesMode.sentenceLabel')}</Text>
      <TextInput
        accessibilityLabel={t('yesMode.sentenceLabel')}
        multiline
        maxLength={TREATMENT_ACTION_SENTENCE_LIMIT}
        value={execution.sentence}
        onChangeText={(sentence) => updateExecution({ sentence })}
        placeholder={t('yesMode.defaultSentence')}
        placeholderTextColor={colors.inkSoft}
        style={[styles.sentenceInput, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
      />
      <View style={[styles.sayBox, { borderColor: colors.secondary, backgroundColor: colors.white }]}>
        <Text style={[styles.sayLabel, { color: colors.inkSoft }]}>{t('yesMode.sayThis')}</Text>
        <Text style={[styles.sayText, { color: colors.ink }]}>
          {execution.sentence.trim() || t('yesMode.defaultSentence')}
        </Text>
      </View>

      <View style={[styles.readiness, { borderColor: leaveProgress.ready && saveState === 'saved' ? colors.green : colors.coral }]}>
        <Text style={[styles.readinessTitle, { color: leaveProgress.ready && saveState === 'saved' ? colors.green : colors.coral }]}>
          {leaveProgress.ready && saveState === 'saved'
            ? t('yesMode.leaveReady')
            : t('yesMode.leaveNotReady', { completed: leaveProgress.completed, total: leaveProgress.total })}
        </Text>
        <Text style={[styles.readinessBody, { color: colors.inkSoft }]}>
          {!leaveProgress.structuredReady
            ? t('yesMode.structuredMissing')
            : saveState !== 'saved'
              ? t('yesMode.notSaved')
              : t('yesMode.leaveReadyBody')}
        </Text>
      </View>

      <View style={styles.actionStack}>
        {state.mode === 'idle' ? (
          <TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.coral }]} onPress={logYes}>
            <Text style={styles.primaryText}>{t('yesMode.logYes')}</Text>
          </TouchableOpacity>
        ) : (
          <>
            {state.mode === 'active' ? (
              <TouchableOpacity accessibilityRole="button" style={[styles.secondaryButton, { borderColor: colors.coral }]} onPress={confirmRecant}>
                <Text style={[styles.secondaryText, { color: colors.coral }]}>{t('yesMode.changedMind')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity accessibilityRole="button" style={[styles.secondaryButton, { borderColor: colors.primary }]} onPress={logYes}>
                <Text style={[styles.secondaryText, { color: colors.primary }]}>{t('yesMode.yesAgain')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function RoleField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.roleField}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxLength={TREATMENT_ACTION_EXECUTION_LIMIT}
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream }]}
      />
    </View>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="button" style={[styles.smallButton, { borderColor: colors.primary }]} onPress={onPress}>
      <Text style={[styles.smallButtonText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: 20, padding: 18, marginBottom: 14 },
  kicker: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', marginTop: 5 },
  body: { fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  clockRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  clockBox: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10 },
  clockLabel: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6 },
  clockValue: { fontSize: 14, lineHeight: 19, fontWeight: '900', marginTop: 3 },
  recantBox: { borderWidth: 1.5, borderRadius: 13, padding: 13, marginTop: 14 },
  recantTitle: { fontSize: 14, fontWeight: '900' },
  recantBody: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginTop: 17, marginBottom: 2 },
  label: { fontSize: 11.5, fontWeight: '800', marginTop: 11, marginBottom: 5 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 13.5 },
  inputHelp: { fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  sentenceInput: { minHeight: 68, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 13.5, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  smallButton: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  smallButtonText: { fontSize: 12.5, fontWeight: '800' },
  lockedDeparture: { borderWidth: 1, borderRadius: 11, padding: 11 },
  lockedTime: { fontSize: 14, fontWeight: '900' },
  lockedHint: { fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleField: { minWidth: '47%', flexGrow: 1 },
  sayBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 11 },
  sayLabel: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  sayText: { fontSize: 15, lineHeight: 21, fontWeight: '700', marginTop: 4 },
  readiness: { borderWidth: 1.5, borderRadius: 13, padding: 12, marginTop: 13 },
  readinessTitle: { fontSize: 14, fontWeight: '900' },
  readinessBody: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  actionStack: { gap: 9, marginTop: 13 },
  primaryButton: { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  callButton: { borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondaryButton: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '900' },
});
