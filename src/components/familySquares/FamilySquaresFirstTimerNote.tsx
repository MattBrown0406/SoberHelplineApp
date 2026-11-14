import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useFirstTimerNote } from '../../hooks/useFirstTimerNote';

const POINTS = ['zoom', 'camera', 'listen', 'length'] as const;

interface Props {
  accountId: string | null;
  /** 'onPrimary' is for the onboarding done screen (white on the brand colour). */
  tone?: 'card' | 'onPrimary';
}

/**
 * "What to expect" for someone who has never been to Family Squares: the
 * practical things that make a first meeting less daunting. It goes away for
 * good when she hides it or first taps Join.
 */
export function FamilySquaresFirstTimerNote({ accountId, tone = 'card' }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const { visible, dismiss } = useFirstTimerNote(accountId);
  if (!visible) return null;

  const onPrimary = tone === 'onPrimary';
  const ink = onPrimary ? '#fff' : colors.ink;
  const soft = onPrimary ? 'rgba(255,255,255,0.85)' : colors.inkSoft;
  const accent = onPrimary ? '#fff' : colors.primary;

  return (
    <View
      style={[
        styles.note,
        onPrimary
          ? { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)' }
          : { backgroundColor: colors.primaryLight, borderColor: colors.line },
      ]}
    >
      <Text style={[styles.title, { color: ink }]} accessibilityRole="header">{t('familySquares.firstTime.title')}</Text>
      {POINTS.map((point) => (
        <Text key={point} style={[styles.point, { color: soft }]}>
          {'• '}{t(`familySquares.firstTime.${point}`)}
        </Text>
      ))}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('familySquares.firstTime.dismissLabel')}
        onPress={dismiss}
        activeOpacity={0.75}
        style={styles.dismiss}
      >
        <Text style={[styles.dismissText, { color: accent }]}>{t('familySquares.firstTime.dismiss')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, marginTop: 12 },
  title: { fontSize: 13.5, fontWeight: '700', marginBottom: 6 },
  point: { fontSize: 13, lineHeight: 19, marginBottom: 2 },
  dismiss: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 4 },
  dismissText: { fontSize: 13, fontWeight: '700' },
});
