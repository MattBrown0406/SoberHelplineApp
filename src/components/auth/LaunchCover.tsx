import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// The launch screen, drawn again by the app: the same background, mark and
// size as app.json gives expo-splash-screen, so nothing moves when the native
// launch screen hands over. tests/front-door-visuals.test.ts keeps them equal.
export const LAUNCH_BACKGROUND = '#142a47';
export const LAUNCH_MARK_WIDTH = 130;
const MARK = require('../../../assets/images/lighthouse-mark.png');

/**
 * Covers the app while it is still finding out who is here. Without it a
 * signed-out person saw the Today tab for a moment before "Create your
 * account" (the tabs are the router's first screen until the session is read).
 * It sits on top of the router's screens; it never unmounts or hides them.
 */
export function LaunchCover() {
  return (
    <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.cover]}>
      <StatusBar style="light" />
      <Image accessible={false} source={MARK} style={styles.mark} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  mark: { width: LAUNCH_MARK_WIDTH, height: LAUNCH_MARK_WIDTH },
});
