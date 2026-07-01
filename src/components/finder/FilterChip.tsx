import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

export type ChipTone = 'navy' | 'amber' | 'green';

export function FilterChip({
  label,
  selected,
  onPress,
  tone = 'navy',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: ChipTone;
}) {
  const { colors } = useTheme();
  const selBg =
    tone === 'amber' ? colors.secondary : tone === 'green' ? colors.green : colors.primary;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? selBg : colors.line, backgroundColor: selected ? selBg : '#fff' },
      ]}
    >
      <Text style={[styles.label, { color: selected ? '#fff' : colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 22,
    borderWidth: 1,
  },
  label: { fontSize: 13.5 },
});
