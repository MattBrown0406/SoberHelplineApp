import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccount } from '../../contexts/AccountContext';
import { useFirstTimerNote } from '../../hooks/useFirstTimerNote';

const POINTS = ['zoom', 'camera', 'listen', 'length'] as const;

interface Props {
  accountId: string | null;
  /** 'onPrimary' is for the onboarding done screen (white on the brand colour). */
  tone?: 'card' | 'onPrimary';
}

/**
 * "What to expect" for someone who has never been to Family Squares: the
 * practical things that make a first meeting less daunting. Shown only to an
 * account created in the last 30 days; it goes away for good when she first
 * taps Join. The first time it is shown it is open; after that, or after
 * "Got it", it is one line that opens it again (the onboarding done screen
 * always starts with it open).
 */
export function FamilySquaresFirstTimerNote({ accountId, tone = 'card' }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const onPrimary = tone === 'onPrimary';
  // Only for a new account (created in the last 30 days): when it was made.
  const { user } = useAccount();
  const { visible, open, dismiss, expand } = useFirstTimerNote(accountId, user && user.id === accountId ? user.joinedAt : null, onPrimary);
  if (!visible) return null;

  // Ink on the pale blue (white on the brand colour): the points are for reading, not a footnote.
  const ink = onPrimary ? '#fff' : colors.ink;
  const accent = onPrimary ? '#fff' : colors.primary;
  const box = onPrimary
    ? { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)' }
    : { backgroundColor: colors.primaryLight, borderColor: colors.line };

  if (!open) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('familySquares.firstTime.title')}
        accessibilityState={{ expanded: false }}
        onPress={expand}
        activeOpacity={0.75}
        style={[styles.note, styles.folded, box]}
      >
        <Text style={[styles.foldedTitle, { color: ink }]}>{t('familySquares.firstTime.title')}</Text>
        <Text style={[styles.chevron, { color: accent }]} accessibilityElementsHidden importantForAccessibility="no">›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.note, styles.open, box]}>
      <Text style={[styles.title, { color: ink }]} accessibilityRole="header">{t('familySquares.firstTime.title')}</Text>
      {POINTS.map((point) => (
        // The bullet has its own column, so a wrapped line starts under the words, not under the bullet.
        <View key={point} style={styles.pointRow}>
          <Text style={[styles.bullet, { color: ink }]} accessibilityElementsHidden importantForAccessibility="no">•</Text>
          <Text style={[styles.point, { color: ink }]}>{t(`familySquares.firstTime.${point}`)}</Text>
        </View>
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
  note: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, marginTop: 10 },
  open: { paddingTop: 12 },
  folded: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8 },
  foldedTitle: { flex: 1, fontSize: 13.5, fontWeight: '700' },
  chevron: { fontSize: 20, fontWeight: '700' },
  title: { fontSize: 13.5, fontWeight: '700', marginBottom: 6 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 3 },
  bullet: { fontSize: 13, lineHeight: 19 },
  point: { flex: 1, fontSize: 13, lineHeight: 19 },
  dismiss: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 4 },
  dismissText: { fontSize: 13, fontWeight: '700' },
});
