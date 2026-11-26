import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { EmergencyActions } from '../safety/EmergencyActions';

// The launch screen, drawn again by the app: the same background, mark and
// size as app.json gives expo-splash-screen, so nothing moves when the native
// launch screen hands over. tests/front-door-visuals.test.ts keeps them equal.
export const LAUNCH_BACKGROUND = '#142a47';
export const LAUNCH_MARK_WIDTH = 130;
const MARK = require('../../../assets/images/lighthouse-mark.png');

/** Space kept between the mark and the emergency card, and above the mark when it has to move up. */
const MARK_GAP = 24;
const MIN_MARK_TOP = 56;

/**
 * Where the mark's top sits on a slow start. Centred, exactly where the launch
 * screen draws it, while the emergency card (its measured height, with its
 * bottom margin) fits under it; moved up as far as needed when the card is
 * taller (Spanish, large text, a small screen); never above MIN_MARK_TOP, and
 * past that the cover scrolls. Pure, for tests.
 */
export function launchMarkTop(viewportHeight: number, cardHeight: number): number {
  const centred = (viewportHeight - LAUNCH_MARK_WIDTH) / 2;
  const fits = viewportHeight - cardHeight - MARK_GAP - LAUNCH_MARK_WIDTH;
  return Math.max(MIN_MARK_TOP, Math.min(centred, fits));
}

/**
 * Covers the app while it is still finding out who is here. Without it a
 * signed-out person saw the Today tab for a moment before "Create your
 * account" (the tabs are the router's first screen until the session is read).
 * It sits on top of the router's screens; it never unmounts or hides them.
 */
export function LaunchCover({ emergency = false }: { emergency?: boolean }) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  return (
    <View
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, styles.cover]}
      onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
    >
      <StatusBar style="light" />
      {/* A slow start: the emergency actions sit at the bottom, under the
          mark (which stays where it was while they fit), so help is never
          behind a launch screen. When they don't fit (Spanish, large text)
          the mark moves up and the cover scrolls, so nothing overlaps. Only
          where the words are loaded (the root layout passes this, never the
          pre-words cover). */}
      {emergency && viewportHeight > 0 ? (
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={[styles.scrollContent, { paddingTop: launchMarkTop(viewportHeight, cardHeight) }]}
          showsVerticalScrollIndicator={false}
        >
          <Image accessible={false} source={MARK} style={styles.mark} />
          <View style={styles.spacer} />
          <View style={styles.emergency} onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}>
            <View style={styles.emergencyInner}>
              <EmergencyActions />
            </View>
          </View>
        </ScrollView>
      ) : (
        <Image accessible={false} source={MARK} style={styles.mark} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  mark: { width: LAUNCH_MARK_WIDTH, height: LAUNCH_MARK_WIDTH },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  spacer: { flexGrow: 1, minHeight: MARK_GAP },
  emergency: { width: '100%', paddingHorizontal: 20, paddingBottom: 48, alignItems: 'center' },
  emergencyInner: { width: '100%', maxWidth: 480 },
});
