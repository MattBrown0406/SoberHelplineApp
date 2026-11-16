import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { logMembershipPath } from '../../lib/funnel';
import { plansHref, type PlanSource } from '../../lib/membershipPath';

/**
 * One compact row that says what members see in this place, with "See plans".
 * No sample, blurred or made-up data: only the lock, one line and the button.
 *
 * `line` and `label` are already-translated strings. The row logs that it was
 * on screen once each time it mounts, and each tap.
 */
export function LockedPreviewRow({ source, line, label }: { source: PlanSource; line: string; label: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('plans');
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    logMembershipPath('membership_invite_shown', { source });
  }, [source]);
  return (
    <TouchableOpacity
      style={[styles.row, { borderColor: colors.line, backgroundColor: colors.white }]}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        logMembershipPath('membership_invite_tapped', { source });
        router.push(plansHref(source));
      }}
    >
      <Text accessible={false} style={styles.lock}>🔒</Text>
      <View style={styles.copy}>
        <Text style={[styles.line, { color: colors.ink }]}>{line}</Text>
        <Text style={[styles.cta, { color: colors.primary }]}>{t('seePlans')} ›</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  lock: { fontSize: 18 },
  copy: { flex: 1 },
  line: { fontSize: 14, lineHeight: 20 },
  cta: { fontSize: 14, fontWeight: '700', marginTop: 4 },
});
