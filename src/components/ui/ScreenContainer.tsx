import React from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';

export const MAX_CONTENT_WIDTH = 640;
const H_PADDING = 20;

/** Height of the tab bar above the bottom safe-area inset (app/(tabs)/_layout.tsx). */
export const TAB_BAR_HEIGHT = 64;
/** The floating Safety button (SafetyShortcut): how far its tap target sits above the tab bar, and how tall that target is. */
export const SAFETY_SHORTCUT_GAP = 2;
export const SAFETY_SHORTCUT_TARGET = 44;
/**
 * Bottom padding a tab screen needs so its last button can be scrolled above
 * the Safety button: the button's offset, its height, and a margin.
 */
export const TAB_SCREEN_BOTTOM_CLEARANCE = SAFETY_SHORTCUT_GAP + SAFETY_SHORTCUT_TARGET + 14;

/**
 * Bottom padding for a tab screen's content: never less than the clearance,
 * and never less than what the screen asked for itself.
 */
export function tabScreenBottomPadding(callerPadding: unknown): number {
  return Math.max(typeof callerPadding === 'number' ? callerPadding : 0, TAB_SCREEN_BOTTOM_CLEARANCE);
}

interface Props {
  children: React.ReactNode;
  /** Set false to skip ScrollView and render children in a plain View. */
  scroll?: boolean;
  backgroundColor?: string;
  /** Passed to the ScrollView's contentContainerStyle (or the inner View). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: ReadonlyArray<Edge>;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  /** Forward a ref to the inner ScrollView (e.g. to call scrollToEnd). */
  scrollRef?: React.RefObject<ScrollView | null>;
}

/**
 * Drop-in replacement for SafeAreaView + ScrollView on every screen.
 * Centres content in a 640 px max-width column — a no-op on phones
 * (< 640 px), comfortable reading column on iPad.
 *
 * On the tabs, where the Safety button floats above the tab bar, the content
 * gets enough bottom padding to scroll clear of it. Other screens keep theirs.
 */
export function ScreenContainer({
  children,
  scroll = true,
  backgroundColor,
  contentContainerStyle,
  edges,
  keyboardShouldPersistTaps = 'handled',
  scrollRef,
}: Props) {
  const { colors } = useTheme();
  const bg = backgroundColor ?? colors.cream;
  // Same test as SafetyShortcut: the button is shown exactly where this is true.
  const onTab = useSegments()[0] === '(tabs)';
  const caller = onTab ? StyleSheet.flatten(contentContainerStyle) : undefined;

  const innerStyle: StyleProp<ViewStyle> = [
    styles.inner,
    contentContainerStyle,
    onTab && {
      paddingBottom: tabScreenBottomPadding(
        caller?.paddingBottom ?? caller?.paddingVertical ?? caller?.padding ?? styles.inner.paddingBottom,
      ),
    },
  ];

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: bg }]}
      edges={edges}
    >
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={innerStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[innerStyle, styles.nonScrollInner]}>{children}</View>
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
  nonScrollInner: { flexGrow: 1 },
});
