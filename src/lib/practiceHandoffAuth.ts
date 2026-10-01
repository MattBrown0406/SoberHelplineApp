import { supabase } from './supabase';
import { clearPracticeHandoffs } from './practiceHandoff';

export { peekPracticeText, releasePracticeText, stashPracticeText } from './practiceHandoff';

/**
 * Wires the practice-text handoff to auth: any sign-out clears every stashed
 * letter. Registered once, the first time a screen that stashes or reads a
 * handoff loads this module.
 */
let watching = false;
export function watchSignOutForPracticeHandoffs(): void {
  if (watching) return;
  watching = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearPracticeHandoffs();
  });
}

watchSignOutForPracticeHandoffs();
