import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The row that opens and closes a tucked-away section of Today: the title on
 * the left, a chevron on the right, a hairline under it so the rows read as a
 * list. Open or closed is announced by the expanded state (and "Show" / "Hide"
 * as the hint), not written into the title.
 */
export function TodayDisclosureToggle({ title, expanded, onPress }: { title: string; expanded: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  return (
    <TouchableOpacity
      accessibilityRole="button"
      aria-expanded={expanded} accessibilityState={{ expanded }}
      accessibilityLabel={title}
      accessibilityHint={t(expanded ? 'disclosure.hide' : 'disclosure.show')}
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, { borderBottomColor: colors.line, marginBottom: expanded ? 12 : 0 }]}
    >
      <Text style={[styles.title, { color: colors.primary }]}>{title}</Text>
      <MaterialCommunityIcons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={24}
        color={colors.primary}
        accessible={false}
        importantForAccessibility="no"
      />
    </TouchableOpacity>
  );
}

/** Keep opened forms mounted when tucked away so collapsing never loses edits. */
export function TodayDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  return (
    <View>
      <TodayDisclosureToggle
        title={title}
        expanded={expanded}
        onPress={() => { setVisited(true); setExpanded(value => !value); }}
      />
      {visited && <View style={{ display: expanded ? 'flex' : 'none' }}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  // No fixed height: the title wraps at large text sizes and the row grows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' },
});
