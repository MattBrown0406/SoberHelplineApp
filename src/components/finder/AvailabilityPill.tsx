import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Availability } from '../../api/providers';
import { useAvailabilityColor } from './finderColors';

export function AvailabilityPill({
  availability,
  onDark = false,
}: {
  availability: Availability;
  onDark?: boolean;
}) {
  const c = useAvailabilityColor(availability);
  const { t } = useTranslation('finder');
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: onDark ? 'rgba(255,255,255,0.14)' : c.bg },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: c.dot }]} />
      <Text style={[styles.label, { color: onDark ? '#fff' : c.fg }]}>
        {t(`availability.${availability}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  label: { fontSize: 12, fontWeight: '600' },
});
