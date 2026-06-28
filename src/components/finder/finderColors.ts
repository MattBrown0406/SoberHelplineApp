import { useTheme } from '../../contexts/ThemeContext';
import type { Availability, ProviderType } from '../../api/providers';

// Feature-local darker text shades for amber/green/coral fills (readable on the
// matching *Light backgrounds). Kept here rather than in the theme since they're
// only used by the Finder badges/pills.
export const AMBER_DARK = '#9a611f';
export const GREEN_DARK = '#365a44';
export const CORAL_DARK = '#8f4034';

export function useAvailabilityColor(a: Availability) {
  const { colors } = useTheme();
  if (a === 'now') return { fg: GREEN_DARK, dot: colors.green, bg: colors.greenLight };
  if (a === 'lim') return { fg: AMBER_DARK, dot: colors.secondary, bg: colors.secondaryLight };
  return { fg: CORAL_DARK, dot: colors.coral, bg: colors.coralLight };
}

export function useTypeColor(t: ProviderType) {
  const { colors } = useTheme();
  if (t === 'center') return { fg: colors.primary, bg: colors.primaryLight };
  if (t === 'interventionist') return { fg: AMBER_DARK, bg: colors.secondaryLight };
  return { fg: GREEN_DARK, bg: colors.greenLight };
}
