import React from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

export const MAX_CONTENT_WIDTH = 640;
const H_PADDING = 20;

interface Props {
  children: React.ReactNode;
  /** Set false to skip ScrollView and render children in a plain View. */
  scroll?: boolean;
  backgroundColor?: string;
  /** Passed to the ScrollView's contentContainerStyle (or the inner View). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: ReadonlyArray<Edge>;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}

/**
 * Drop-in replacement for SafeAreaView + ScrollView on every screen.
 * Centres content in a 640 px max-width column — a no-op on phones
 * (< 640 px), comfortable reading column on iPad.
 */
export function ScreenContainer({
  children,
  scroll = true,
  backgroundColor,
  contentContainerStyle,
  edges,
  keyboardShouldPersistTaps = 'handled',
}: Props) {
  const { colors } = useTheme();
  const bg = backgroundColor ?? colors.cream;

  const innerStyle: StyleProp<ViewStyle> = [
    styles.inner,
    contentContainerStyle,
  ];

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: bg }]}
      edges={edges}
    >
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={innerStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={innerStyle}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inner: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    paddingHorizontal: H_PADDING,
    paddingBottom: 48,
    paddingTop: 8,
  },
});
