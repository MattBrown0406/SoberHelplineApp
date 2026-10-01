import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { FreeTierPaywall } from '../ui/FreeTierPaywall';
import { releasePracticeText } from '../../lib/practiceHandoffAuth';

/**
 * The paywall for practice routes that may carry a handed-off letter: when the
 * member can't open practice, the letter they brought is released right away
 * instead of lingering in memory.
 */
export function PracticeHandoffPaywall() {
  const { handoff } = useLocalSearchParams<{ handoff?: string }>();
  useEffect(() => {
    releasePracticeText(handoff);
  }, [handoff]);
  return <FreeTierPaywall />;
}
