type StackState = { key?: string; type?: string; index?: number; routes: readonly { name?: string; state?: StackState }[] };
type StackRef = {
  isReady(): boolean;
  getRootState(): StackState | undefined;
  dispatch(action: { type: string; target?: string }): void;
};

/**
 * A REPLACE swaps only the top screen of the app's stack. Crossing into or out
 * of the signed-in app, first drop screens stacked above the first (e.g.
 * Settings), or the previous account's tabs stay mounted underneath the new
 * ones. expo-router nests app/_layout's Stack under its own `__root` route.
 */
export function collapseAppStack(navigationRef: StackRef): void {
  if (!navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  const app = root?.routes[root.index ?? 0]?.state;
  if (app?.type === 'stack' && app.key && app.routes.length > 1) {
    navigationRef.dispatch({ type: 'POP_TO_TOP', target: app.key });
  }
}

/** app/(auth): sign-up (and its confirm step), sign-in, reset-password. */
const PRE_SIGN_IN_GROUP = '(auth)';

/** The app's own stack (app/_layout's), under expo-router's `__root` route. */
function appStackOf(navigationRef: StackRef): StackState | undefined {
  const root = navigationRef.getRootState();
  const app = root?.routes[root.index ?? 0]?.state;
  return app?.type === 'stack' && app.key ? app : undefined;
}

/**
 * A signed-out person was on a pre-sign-in screen and something put another
 * screen on top of it (a link that opened the app). Replacing the stack with
 * the front door would throw that screen away, and with it the "Confirm your
 * email" step and the password it holds in memory. When the pre-sign-in
 * screen is still the first one in the app's stack, go back to it as it was
 * instead.
 *
 * True only when she really is back on it (the stack is read again after the
 * pop); false leaves the caller to route as usual, so she can never be left
 * on a screen that needs a sign-in.
 */
export function returnToPreSignInScreen(navigationRef: StackRef): boolean {
  if (!navigationRef.isReady()) return false;
  const app = appStackOf(navigationRef);
  if (!app || app.routes.length < 2 || app.routes[0]?.name !== PRE_SIGN_IN_GROUP) return false;
  try {
    navigationRef.dispatch({ type: 'POP_TO_TOP', target: app.key });
  } catch {
    return false;
  }
  const after = appStackOf(navigationRef);
  return after?.routes.length === 1 && after.routes[0]?.name === PRE_SIGN_IN_GROUP;
}
