import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * A light clock and battery for a navy screen, only while that screen is the
 * one in front. A screen left underneath (welcome, under the cream onboarding
 * steps) or left behind gives the status bar back to the app's dark default,
 * so the light style never leaks onto a cream screen.
 */
export function NavyScreenStatusBar() {
  const [inFront, setInFront] = useState(false);
  useFocusEffect(useCallback(() => {
    setInFront(true);
    return () => setInFront(false);
  }, []));
  return inFront ? <StatusBar style="light" /> : null;
}
