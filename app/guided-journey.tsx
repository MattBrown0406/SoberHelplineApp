import React, { useState } from 'react';
import { Redirect } from 'expo-router';

/**
 * The old 4-step starting-point journey (4.3 and before). Today now has one
 * "where to start": "Your path" (the loved one's phase and her next step for
 * it), under "More for you". This route stays because a winback push and the
 * check-in's "a practical next step" answer still open it: it goes to Today
 * with "More for you" open. Steps an older version saved on the device are
 * left as they are and no longer read here.
 */
export default function GuidedJourneyScreen() {
  // A fresh value per visit, so Today opens "More for you" again on a repeat visit.
  const [visit] = useState(() => String(Date.now()));
  return <Redirect href={{ pathname: '/(tabs)', params: { more: '1', n: visit } }} />;
}
