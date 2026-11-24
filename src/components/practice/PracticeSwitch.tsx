import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

export type PracticeSection = 'conversations' | 'boundaries';

export const PRACTICE_SECTIONS: readonly PracticeSection[] = ['conversations', 'boundaries'];

/** The `section` search param as a part of Practice; anything else is Conversations. */
export function practiceSectionFromParam(value: unknown): PracticeSection {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'boundaries' ? 'boundaries' : 'conversations';
}

/**
 * The two-part switch at the top of Practice: Conversations | Boundaries.
 * Each part is a 44-point tab with its selected state read aloud; the words
 * wrap at large text sizes instead of being cut off.
 */
export function PracticeSwitch({
  value,
  onChange,
}: {
  value: PracticeSection;
  onChange: (next: PracticeSection) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('scripts');

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { borderColor: colors.line, backgroundColor: colors.white }]}
    >
      {PRACTICE_SECTIONS.map((section) => {
        const selected = value === section;
        return (
          <TouchableOpacity
            key={section}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) onChange(section); }}
            activeOpacity={0.85}
            style={[styles.part, selected && { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.label, { color: selected ? colors.white : colors.ink }]}>
              {t(`sections.${section}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  part: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
