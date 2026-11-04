import React, { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { normalizeRecoveryPhase, RECOVERY_PHASES, type RecoveryPhase } from '../../lib/recoveryPathway';
import {
  lovedOneCheckDue,
  lovedOneCheckSnoozeUntil,
  lovedOneCheckStorageKey,
  type LovedOneCheckReason,
} from '../../lib/todayPrompts';

interface Props {
  accountId: string | null;
  /** The saved record, or null when she has none yet. */
  lovedOne: { first_name: string | null; stage: string | null; status: string | null; updated_at: string | null } | null;
  /** Hidden while the record is loading or unreadable: never ask over a read error. */
  ready: boolean;
  pressureScore: number | null | undefined;
  onSavePhase: (phase: RecoveryPhase) => Promise<unknown>;
}

/**
 * One tap on Today: where things are with her loved one right now. Asked when
 * she has never said, monthly after that, and sooner after a heavy check-in.
 */
export function LovedOneCheckCard({ accountId, lovedOne, ready, pressureScore, onSavePhase }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  // undefined until the snooze has been read, so the card never flashes.
  const [snoozedUntil, setSnoozedUntil] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState<RecoveryPhase | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [thanked, setThanked] = useState(false);
  // Saving refreshes the record, which clears `due` before the save resolves:
  // keep the question on screen until the thanks replaces it.
  const lastReason = useRef<LovedOneCheckReason | null>(null);

  useFocusEffect(useCallback(() => {
    setNow(new Date());
    if (!accountId) {
      setSnoozedUntil(undefined);
      return undefined;
    }
    let cancelled = false;
    AsyncStorage.getItem(lovedOneCheckStorageKey(accountId))
      .then((value) => { if (!cancelled) setSnoozedUntil(value); })
      .catch(() => { if (!cancelled) setSnoozedUntil(null); });
    return () => { cancelled = true; };
  }, [accountId]));

  const due = ready && snoozedUntil !== undefined
    ? lovedOneCheckDue({
      hasRecord: !!lovedOne,
      stage: lovedOne?.stage,
      updatedAt: lovedOne?.updated_at,
      pressureScore,
      snoozedUntil,
      now,
    })
    : null;
  if (due) lastReason.current = due;
  const reason = due ?? (saving ? lastReason.current : null);

  if (!accountId) return null;
  if (thanked) {
    return (
      <View style={[styles.card, { backgroundColor: colors.greenLight, borderColor: colors.green }]}>
        <Text accessibilityRole="text" style={[styles.thanks, { color: colors.ink }]}>{t('lovedOneCheck.thanks')}</Text>
      </View>
    );
  }
  if (!reason) return null;

  const name = lovedOne?.first_name?.trim() || null;
  const current = lovedOne?.stage ? normalizeRecoveryPhase(lovedOne.stage, lovedOne.status) : null;
  const titleKey = reason === 'missing' ? 'titleMissing' : reason === 'pressure' ? 'titlePressure' : 'titleStale';
  const title = name ? t(`lovedOneCheck.${titleKey}`, { name }) : t(`lovedOneCheck.${titleKey}NoName`);

  const save = async (phase: RecoveryPhase) => {
    if (saving) return;
    setSaving(phase);
    setSaveError(false);
    try {
      await onSavePhase(phase);
      setThanked(true);
      AccessibilityInfo.announceForAccessibility?.(t('lovedOneCheck.thanks'));
    } catch {
      setSaveError(true);
    } finally {
      setSaving(null);
    }
  };

  const snooze = () => {
    const until = lovedOneCheckSnoozeUntil(new Date());
    setSnoozedUntil(until);
    void AsyncStorage.setItem(lovedOneCheckStorageKey(accountId), until).catch(() => undefined);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('lovedOneCheck.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('lovedOneCheck.body')}</Text>
      {current && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('lovedOneCheck.sameAccessibility', { phase: t(`pathway.phases.${current}.label`) })}
          disabled={!!saving}
          onPress={() => void save(current)}
          activeOpacity={0.85}
          style={[styles.same, { backgroundColor: colors.primary, opacity: saving && saving !== current ? 0.6 : 1 }]}
        >
          {saving === current ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.sameText}>{t('lovedOneCheck.same', { phase: t(`pathway.phases.${current}.label`) })}</Text>
          )}
        </TouchableOpacity>
      )}
      <View accessibilityRole="radiogroup" style={styles.options}>
        {RECOVERY_PHASES.filter((phase) => phase !== current).map((phase) => (
          <TouchableOpacity
            key={phase}
            accessibilityRole="radio"
            accessibilityState={{ checked: false, busy: saving === phase }}
            accessibilityLabel={t(`pathway.phases.${phase}.label`)}
            disabled={!!saving}
            onPress={() => void save(phase)}
            activeOpacity={0.8}
            style={[styles.option, { borderColor: colors.line, backgroundColor: colors.cream, opacity: saving && saving !== phase ? 0.6 : 1 }]}
          >
            {saving === phase ? <ActivityIndicator color={colors.primary} /> : (
              <Text style={[styles.optionText, { color: colors.ink }]}>{t(`pathway.phases.${phase}.label`)}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
      {saveError && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('lovedOneCheck.saveError')}</Text>
      )}
      <Text style={[styles.privacy, { color: colors.inkSoft }]}>{t('pathway.privacy')}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={snooze} disabled={!!saving} style={styles.notNow}>
        <Text style={[styles.notNowText, { color: colors.inkSoft }]}>{t('lovedOneCheck.notNow')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '800', marginBottom: 6 },
  body: { fontSize: 14.5, lineHeight: 21, marginBottom: 12 },
  same: { borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginBottom: 10 },
  sameText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderRadius: 999, minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' },
  optionText: { fontSize: 14, fontWeight: '700' },
  error: { fontSize: 13.5, fontWeight: '700', marginTop: 10 },
  privacy: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  notNow: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  notNowText: { fontSize: 13.5, fontWeight: '700' },
  thanks: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
});
