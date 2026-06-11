import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

interface CastleSectionData {
  id: string;
  icon: string;
  title: string;
  body: string;
}

interface Props {
  section: CastleSectionData;
  isLast?: boolean;
}

export function CastleSection({ section, isLast }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  }

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.line }, isLast && styles.rowLast]}
      onPress={toggle}
      activeOpacity={0.7}
    >
      <View style={styles.head}>
        <Text style={styles.icon}>{section.icon}</Text>
        <Text style={[styles.title, { color: colors.ink }]}>{section.title}</Text>
        <Text style={[styles.chevron, { color: colors.inkSoft }, open && styles.chevronOpen]}>
          ▶
        </Text>
      </View>
      {open && (
        <Text style={[styles.body, { color: colors.inkSoft }]}>{section.body}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    fontSize: 18,
    width: 26,
    textAlign: 'center',
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  chevron: {
    fontSize: 11,
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  body: {
    marginTop: 10,
    marginLeft: 36,
    fontSize: 13,
    lineHeight: 20,
  },
});
