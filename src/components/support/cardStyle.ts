import type { ViewStyle } from 'react-native';

/** The Support tab's card: white, a hairline border, a faint shadow. */
export const supportCard: ViewStyle = {
  backgroundColor: '#fff',
  borderRadius: 18,
  padding: 16,
  marginBottom: 12,
  borderWidth: 1,
  shadowColor: '#22302f',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.04,
  shadowRadius: 3,
  elevation: 1,
};

/** The small capitals over a card or a section. */
export const supportEyebrow = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  marginBottom: 12,
} as const;
