import React from 'react';
import { TouchableOpacity, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The one shape for full-width primary and secondary action buttons: the fully
 * rounded pill the sign-up, sign-in and onboarding screens use. Screens that
 * draw their own button spread `buttonShape` into its style, so the radius and
 * the height are written once, here.
 *
 * Colour: a primary action is `colors.primary` with white text; a secondary
 * one is an outline or `colors.primaryLight` with primary text. Coral is only
 * for danger and safety, green only for something confirmed.
 */
export const BUTTON_RADIUS = 99;
export const BUTTON_MIN_HEIGHT = 48;
export const buttonShape = {
  borderRadius: BUTTON_RADIUS,
  minHeight: BUTTON_MIN_HEIGHT,
  // Room at the round ends, so a label that wraps stays inside the pill.
  paddingHorizontal: 20,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

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
    ...buttonShape,
    paddingVertical: 14,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
