import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { WelcomeBackAction } from '../../lib/welcomeBack';

interface Props {
  /** What is useful right now (welcomeBackActions); may be empty. */
  actions: WelcomeBackAction[];
  onSaveSeat: () => void;
  onCheckIn: () => void;
  onDismiss: () => void;
}

/**
 * A small hello at the top of Today when she is back after a week or more
 * away. Warm and short: no streaks, no "you missed", no numbers.
 */
export function WelcomeBackCard({ actions, onSaveSeat, onCheckIn, onDismiss }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  return (
    <View style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('welcomeBack.title')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('welcomeBack.body')}</Text>
      <View style={styles.actions}>
        {actions.includes('saveSeat') && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('welcomeBack.saveSeatLabel')}
            onPress={onSaveSeat}
            activeOpacity={0.85}
            style={[styles.action, { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Text style={[styles.actionText, { color: '#fff' }]}>{t('welcomeBack.saveSeat')}</Text>
          </TouchableOpacity>
        )}
        {actions.includes('checkIn') && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('welcomeBack.checkInLabel')}
            onPress={onCheckIn}
            activeOpacity={0.85}
            style={[styles.action, { backgroundColor: colors.white, borderColor: colors.primary }]}
          >
            <Text style={[styles.actionText, { color: colors.primary }]}>{t('welcomeBack.checkIn')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('welcomeBack.dismissLabel')}
          onPress={onDismiss}
          activeOpacity={0.75}
          style={styles.dismiss}
        >
          <Text style={[styles.dismissText, { color: colors.inkSoft }]}>{t('welcomeBack.dismiss')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 13.5, lineHeight: 20, marginTop: 2, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  action: { minHeight: 44, justifyContent: 'center', borderRadius: 99, borderWidth: 1.5, paddingHorizontal: 16 },
  actionText: { fontSize: 14, fontWeight: '700' },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  dismissText: { fontSize: 13.5, fontWeight: '600' },
});
