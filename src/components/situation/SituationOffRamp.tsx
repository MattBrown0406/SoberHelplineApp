import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { DOOR_COPY_KEY, DOOR_ROUTE, type FunnelDoor } from '../../lib/situation';

interface Props {
  /** The funnel door for the current situation. `free_call` renders nothing —
   *  the free call is the Today anchor, not an escalation step. */
  door: FunnelDoor;
  /** Runs before navigation (e.g. close a modal sheet). */
  onBeforeNavigate?: () => void;
  /** Tighter spacing for embedding inside the crisis sheet. */
  compact?: boolean;
}

/**
 * The situation-aware next step shown beneath safety options on the crisis sheet
 * and beneath the warning spike alert on the tracker. Only ever an *offer* — it
 * is rendered subordinate to 988/911, never in their place, and only appears for
 * an escalated band (coaching / intervention).
 */
export function SituationOffRamp({ door, onBeforeNavigate, compact }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();

  if (door === 'free_call') return null;
  const route = DOOR_ROUTE[door];
  if (!route) return null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        onBeforeNavigate?.();
        router.push(route as never);
      }}
      style={[
        styles.card,
        { backgroundColor: colors.primaryLight, borderColor: colors.primary },
        compact && styles.cardCompact,
      ]}
    >
      <Text style={[styles.title, { color: colors.primary }]}>
        {t(DOOR_COPY_KEY[door])}
      </Text>
      <Text style={[styles.sub, { color: colors.ink }]}>
        {t(`situationCta.${door}Sub`)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 4,
  },
  cardCompact: { padding: 12, borderRadius: 12 },
  title: { fontSize: 14.5, fontWeight: '700' },
  sub: { fontSize: 12.5, lineHeight: 18 },
});
