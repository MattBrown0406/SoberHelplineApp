import React from 'react';
import { TouchableOpacity, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, busy = false, accessibilityLabel, accessibilityHint, style }: Props) {
  const { colors } = useTheme();
  const isPrimary = variant === 'primary';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isPrimary
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.primaryLight },
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      <Text style={[styles.label, { color: isPrimary ? '#fff' : colors.primary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
