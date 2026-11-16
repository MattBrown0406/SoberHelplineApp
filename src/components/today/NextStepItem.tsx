import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  NEXT_STEP_FALLBACK_WAIT_MS,
  chooseNextStep,
  type NextStepCard,
  type NextStepChoice,
} from '../../lib/todayNextStep';

/**
 * One candidate for Today's "next step" slot. The card inside keeps its own
 * show/hide rules and is not changed: this wrapper only notices whether the
 * card drew anything, and tucks it out of sight (still mounted, so it keeps
 * what she typed and can speak up later) when it is neither in the slot nor
 * under an open "More for this week".
 */
export function NextStepItem({ shown, onShowing, children }: {
  shown: boolean;
  /** Whether the card inside has something to show right now. */
  onShowing: (showing: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <View
      style={shown ? undefined : styles.tucked}
      pointerEvents={shown ? 'auto' : 'none'}
      // Tucked away means gone for screen readers too.
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!shown}
    >
      {/* Measured even while tucked: a card that draws nothing has no height. */}
      <View onLayout={(event) => onShowing(event.nativeEvent.layout.height > 0)}>{children}</View>
    </View>
  );
}

/**
 * Which of the candidate cards have something to show, and so which one gets
 * the slot (chooseNextStep). The always-there fallback waits a moment before
 * taking the slot, so a card that loads a beat later does not swap in under
 * her thumb.
 */
export function useNextStep(): NextStepChoice & { report: (card: NextStepCard, showing: boolean) => void } {
  const [showing, setShowing] = useState<Partial<Record<NextStepCard, boolean>>>({});
  const [fallbackReady, setFallbackReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setFallbackReady(true), NEXT_STEP_FALLBACK_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  const report = useCallback((card: NextStepCard, isShowing: boolean) => {
    setShowing((prev) => (prev[card] === isShowing ? prev : { ...prev, [card]: isShowing }));
  }, []);

  return { ...chooseNextStep(showing, { fallbackReady }), report };
}

const styles = StyleSheet.create({
  tucked: { height: 0, overflow: 'hidden' },
});
