import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

/** Shared building blocks so every Invitation Engine screen looks and reads the same. */

export function EngineCard({
  children,
  tone = 'plain',
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'warm' | 'alert' | 'calm';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const palette = {
    plain: { backgroundColor: colors.white, borderColor: colors.line },
    warm: { backgroundColor: colors.secondaryLight, borderColor: colors.secondary },
    alert: { backgroundColor: colors.coralLight, borderColor: colors.coral },
    calm: { backgroundColor: colors.greenLight, borderColor: colors.green },
  }[tone];
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.card, palette, style]}>
      {children}
    </View>
  );
}

export function Kicker({ children, color }: { children: React.ReactNode; color?: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.kicker, { color: color ?? colors.primary }]}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  color,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  color?: string;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const inactive = disabled || busy;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: color ?? colors.primary, opacity: inactive ? 0.55 : 1 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  color,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, { borderColor: tint, opacity: disabled ? 0.55 : 1 }]}
    >
      <Text style={[styles.secondaryText, { color: tint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function TextLink({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={styles.link}>
      <Text style={[styles.linkText, { color: color ?? colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function BackLink({ label, onPress, busy = false }: { label: string; onPress: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={12}
      style={styles.back}
    >
      <Text style={[styles.backText, { color: busy ? colors.inkSoft : colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 18, padding: 17, marginBottom: 14 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  primary: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  secondary: {
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryText: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  link: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  linkText: { fontSize: 14, fontWeight: '800' },
  back: { marginBottom: 12, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  backText: { fontSize: 16, fontWeight: '800' },
});
